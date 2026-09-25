"""BB参加スコア v2 検証 + 公募割れ確率（ロジスティック回帰）の walk-forward 評価。

Phase 3 スコープ 2・3・4（scratch/phase3/context.md）。
- 2015〜2023: data/ipo_history.csv（96ut から history-data タスクが作成）
- 2024〜2026: data/ipo_list.csv + fundamentals.csv + public/data/ipos.enriched.json（recalibrate_bb.load_frame を流用）
- 既存6項目 + 新4項目（売出比率・幹事団社数・同週上場件数・直近IPO地合い）の points を算出
- 主幹事実績は「上場日より前の銘柄だけ」で計算（walk-forward でリークしないように）
- 地合いは 日経25日MA乖離（data/out/nikkei_long.csv、yfinance ^N225）と 直近5件IPO初値騰落率 の両方
- 項目別 Spearman・年別安定性・上位/下位30%比較
- ロジスティック回帰（numpy、L2、ニュートン法）: 学習〜2023→検証2024〜 / 学習〜2022→検証2023
  AUC・ブライアスコア・予測確率10分位のキャリブレーション表
- 採用判定を満たせば src/lib/scoring/bb-model.json を書き出す

実行: cd scratch/backtest && WRITE_MODEL=1 ./venv/bin/python recalibrate_bb_v2.py > data/out/recalibrate_bb_v2.log
（WRITE_MODEL=1 のときだけ採用判定を満たした係数を bb-model.json に書き出す）
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd

import recalibrate_bb as v1

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT_DIR = DATA / "out"
ROOT = HERE.parent.parent
ENRICHED = ROOT / "public" / "data" / "ipos.enriched.json"
MODEL_JSON = ROOT / "src" / "lib" / "scoring" / "bb-model.json"
NIKKEI_LONG = OUT_DIR / "nikkei_long.csv"

OLD_KEYS = v1.KEYS  # absorption, offeringRatioBb, underwriterTrack, priceRangePosition, vcLockup, sentiment
NEW_KEYS = ["saleRatio", "underwriterCount", "sameWeekListings", "recentIpoSentiment"]
ALL_KEYS = OLD_KEYS + NEW_KEYS

# 現行重み（bb.ts DEFAULT_BB_WEIGHTS）
CURRENT_WEIGHTS = {
    "absorption": 4,
    "offeringRatioBb": 4,
    "underwriterTrack": 2,
    "priceRangePosition": 3,
    "vcLockup": 2,
    "sentiment": 2,
}

# 直近IPO地合いに使う件数
RECENT_N = 5
# BB期間時点で既知の実績に限る版（上場日の約2週間前が BB 期間）
BB_LAG_DAYS = 14

# ---------------------------------------------------------------------------
# 新項目の閾値（学習期間 2015〜2023 の五分位を目安に丸めた値。レポートに明記）
# ---------------------------------------------------------------------------

# 売出比率（%）: <20=+2 / <40=+1 / <55=0 / <75=-1 / それ以上=-2（低いほど良い）
SALE_RATIO_CUTS = (20.0, 40.0, 55.0, 75.0)
# 幹事団社数: <=6=+2 / 7=+1 / 8=0 / 9=-1 / 10以上=-2（少ないほど良いと仮定）
UW_COUNT_CUTS = (6, 7, 8, 9)
# 同週上場件数（自分を含む）: <=2=+2 / <=4=+1 / 5=0 / <=8=-1 / 9以上=-2（少ないほど良いと仮定）
SAME_WEEK_CUTS = (2, 4, 5, 8)
# 直近5件の初値騰落率平均（%）: >=120=+2 / >=80=+1 / >=55=0 / >=30=-1 / それ未満=-2（高いほど良い）
RECENT_IPO_CUTS = (120.0, 80.0, 55.0, 30.0)


def _is_missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def pts_low_is_good(v, cuts, inclusive: bool) -> int:
    """cuts=(a,b,c,d) 昇順。inclusive=True は「以下」、False は「未満」で判定。"""
    le = (lambda x, t: x <= t) if inclusive else (lambda x, t: x < t)
    a, b, c, d = cuts
    if le(v, a):
        return 2
    if le(v, b):
        return 1
    if le(v, c):
        return 0
    if le(v, d):
        return -1
    return -2


def pts_sale_ratio(r) -> int:
    if _is_missing(r) or r < 0:
        return 0
    return pts_low_is_good(r, SALE_RATIO_CUTS, inclusive=False)


def pts_uw_count(n) -> int:
    if _is_missing(n) or n <= 0:
        return 0
    return pts_low_is_good(n, UW_COUNT_CUTS, inclusive=True)


def pts_same_week(n) -> int:
    if _is_missing(n) or n <= 0:
        return 0
    return pts_low_is_good(n, SAME_WEEK_CUTS, inclusive=True)


def pts_recent_ipo(avg) -> int:
    if _is_missing(avg):
        return 0
    a, b, c, d = RECENT_IPO_CUTS
    if avg >= a:
        return 2
    if avg >= b:
        return 1
    if avg >= c:
        return 0
    if avg >= d:
        return -1
    return -2


# ---------------------------------------------------------------------------
# データ
# ---------------------------------------------------------------------------

UW_ALIASES = {
    "岡三証券（岡三オンライン）": "岡三証券",
    "藍澤證券（アイザワ証券）": "アイザワ証券",
    "Jトラストグローバル証券": "JTG証券",
}


def norm_uw(name) -> str | None:
    if not isinstance(name, str) or not name.strip():
        return None
    first = name.split("・")[0].strip()
    return UW_ALIASES.get(first, first)


def _num(v):
    return v1._num(v)


def load_history() -> pd.DataFrame:
    h = pd.read_csv(DATA / "ipo_history.csv", dtype={"code": str})
    out = pd.DataFrame(
        {
            "code": h["code"],
            "name": h["name"],
            "listing_date": h["listingDate"],
            "offer_price": h["offeringPrice"],
            "first_price": h["initialPrice"],
            "lead": h["leadUnderwriter"].map(norm_uw),
            "absorption_amt": h["absorptionAmount"],
            "offering_ratio": h["offeringRatio"],
            "assumed_price": h["assumedPrice"],
            "range_low": h["priceRangeLow"],
            "range_high": h["priceRangeHigh"],
            "vc": h["vcRatio"],
            "lock_days": h["lockupDays"],
            "lock_15x": h["lockupHasPriceRelease"].map(
                lambda v: None if pd.isna(v) else str(v).strip().lower() == "true"
            ),
            "sale_ratio": h["saleRatio"],
            "uw_count": h["underwriterCount"],
            "source": "history",
        }
    )
    return out


def load_recent() -> pd.DataFrame:
    """2024〜2026。v1.load_frame は offer/first が揃う銘柄だけなので、日程計算用に全件も別途返す。"""
    df = v1.load_frame()
    enriched = {r["code"]: r for r in json.loads(ENRICHED.read_text(encoding="utf-8"))}
    sale_ratio, uw_count = [], []
    for c in df["code"]:
        e = enriched.get(c)
        if not e:
            sale_ratio.append(float("nan"))
            uw_count.append(float("nan"))
            continue
        pub = _num(e.get("publicShares")) or 0
        sale = _num(e.get("saleShares")) or 0
        sale_ratio.append(sale / (pub + sale) * 100 if pub + sale > 0 else float("nan"))
        uws = e.get("underwriters") or []
        uw_count.append(len(uws) if uws else float("nan"))
    return pd.DataFrame(
        {
            "code": df["code"],
            "name": df["name"],
            "listing_date": df["listing_date"],
            "offer_price": df["offer_price"],
            "first_price": df["first_price"],
            "lead": df["lead_underwriter"].map(norm_uw),
            "absorption_amt": df["absorption_amt"],
            "offering_ratio": df["offering_ratio"],
            "assumed_price": df["assumed_price"],
            "range_low": df["range_low"],
            "range_high": df["range_high"],
            "vc": df["vc"],
            "lock_days": df["lock_days"],
            "lock_15x": df["lock_15x"],
            "sale_ratio": sale_ratio,
            "uw_count": uw_count,
            "source": "recent",
        }
    )


def all_listing_dates() -> pd.Series:
    """同週上場件数の母集団（価格の有無を問わない全上場日）。"""
    h = pd.read_csv(DATA / "ipo_history.csv", dtype={"code": str})["listingDate"]
    r = pd.read_csv(DATA / "ipo_list.csv", dtype={"code": str})["listing_date"]
    return pd.to_datetime(pd.concat([h, r], ignore_index=True).dropna())


def load_all() -> pd.DataFrame:
    df = pd.concat([load_history(), load_recent()], ignore_index=True)
    df = df[df["offer_price"].notna() & df["first_price"].notna() & (df["offer_price"] > 0)].copy()
    df["initial_return"] = (df["first_price"] - df["offer_price"]) / df["offer_price"] * 100
    df["break_even"] = (df["initial_return"] < 0).astype(int)
    df["year"] = df["listing_date"].str[:4]
    df = df.sort_values(["listing_date", "code"]).reset_index(drop=True)

    # 同週上場件数（月曜始まりの週、自分を含む）
    dates = all_listing_dates()
    week = dates.dt.to_period("W-SUN").value_counts()
    ld = pd.to_datetime(df["listing_date"])
    df["same_week"] = [int(week.get(p, 1)) for p in ld.dt.to_period("W-SUN")]

    # 直近IPO地合い（上場日より前に上場した直近5件の初値騰落率平均。当日以降は含めない）
    def recent_avg(lag_days: int) -> list[float]:
        out = []
        for d in ld:
            cutoff = d - pd.Timedelta(days=lag_days)
            prior = df.loc[ld < cutoff, "initial_return"]
            out.append(float(prior.iloc[-RECENT_N:].mean()) if len(prior) >= RECENT_N else float("nan"))
        return out

    df["recent_ipo_avg"] = recent_avg(0)
    df["recent_ipo_avg_bb"] = recent_avg(BB_LAG_DAYS)

    # 日経平均 25日MA 乖離（前営業日）
    nk = pd.read_csv(NIKKEI_LONG, parse_dates=["Date"]).sort_values("Date")
    nk["ma25"] = nk["Close"].rolling(25).mean()
    nk["dev"] = (nk["Close"] - nk["ma25"]) / nk["ma25"]
    nk = nk.dropna(subset=["dev"])
    pos = np.searchsorted(nk["Date"].values, ld.values, side="left") - 1
    df["nikkei_dev"] = [float(nk["dev"].iloc[p]) if p >= 0 else float("nan") for p in pos]
    return df


def nikkei_label(dev: float) -> int:
    if dev is None or math.isnan(dev):
        return 0
    if dev > v1.SENTIMENT_DEV_THRESHOLD:
        return 2
    if dev < -v1.SENTIMENT_DEV_THRESHOLD:
        return -2
    return 0


def underwriter_prior(df: pd.DataFrame) -> tuple[list[int], list[float | None]]:
    counts, rates = [], []
    for i, r in df.iterrows():
        mask = (df["lead"] == r["lead"]) & (df["listing_date"] < r["listing_date"])
        peers = df.loc[mask, "initial_return"]
        counts.append(int(len(peers)))
        rates.append(float((peers < 0).mean() * 100) if len(peers) else None)
    return counts, rates


def compute_points(df: pd.DataFrame, recent_col: str = "recent_ipo_avg") -> pd.DataFrame:
    p = pd.DataFrame(index=df.index)
    p["absorption"] = [v1.pts_absorption(_num(v)) for v in df["absorption_amt"]]
    p["offeringRatioBb"] = [v1.pts_offering_ratio(_num(v)) for v in df["offering_ratio"]]
    counts, rates = underwriter_prior(df)
    df["uw_prior_count"] = counts
    p["underwriterTrack"] = [v1.pts_underwriter(c, r) for c, r in zip(counts, rates)]
    p["priceRangePosition"] = [
        v1.pts_price_range(_num(a), _num(lo), _num(hi))
        for a, lo, hi in zip(df["assumed_price"], df["range_low"], df["range_high"])
    ]
    p["vcLockup"] = [
        v1.pts_vc_lockup(_num(v), _num(d), h) for v, d, h in zip(df["vc"], df["lock_days"], df["lock_15x"])
    ]
    p["sentiment"] = [nikkei_label(v) for v in df["nikkei_dev"]]
    p["saleRatio"] = [pts_sale_ratio(_num(v)) for v in df["sale_ratio"]]
    p["underwriterCount"] = [pts_uw_count(_num(v)) for v in df["uw_count"]]
    p["sameWeekListings"] = [pts_same_week(_num(v)) for v in df["same_week"]]
    p["recentIpoSentiment"] = [pts_recent_ipo(_num(v)) for v in df[recent_col]]
    return p


# ---------------------------------------------------------------------------
# 評価
# ---------------------------------------------------------------------------

spearman = v1.spearman


def score(points: pd.DataFrame, weights: dict[str, int]) -> pd.Series:
    keys = [k for k in weights if weights[k] > 0]
    total_w = sum(weights[k] for k in keys)
    raw = sum(points[k] * weights[k] for k in keys)
    s = (raw + 2 * total_w) / (4 * total_w) * 100
    return np.floor(s + 0.5).clip(0, 100)


def evaluate(points, ret, weights) -> dict:
    s = score(points, weights)
    t, b = v1.top_bottom(s, ret)
    return {"spearman": spearman(s, ret), "top": t, "bottom": b}


def quintiles(s: pd.Series) -> str:
    q = s.dropna().quantile([0.2, 0.4, 0.6, 0.8]).round(1).tolist()
    return " / ".join(str(v) for v in q)


# ---------------------------------------------------------------------------
# ロジスティック回帰（L2・ニュートン法）
# ---------------------------------------------------------------------------

def fit_logistic(X: np.ndarray, y: np.ndarray, lam: float = 1.0, iters: int = 50) -> np.ndarray:
    """切片（正則化しない）+ 係数。X は標準化済み。"""
    n, k = X.shape
    Xb = np.hstack([np.ones((n, 1)), X])
    w = np.zeros(k + 1)
    reg = np.eye(k + 1) * lam
    reg[0, 0] = 0.0
    for _ in range(iters):
        z = Xb @ w
        p = 1 / (1 + np.exp(-z))
        g = Xb.T @ (p - y) + reg @ w
        H = Xb.T @ (Xb * (p * (1 - p))[:, None]) + reg
        step = np.linalg.solve(H, g)
        w -= step
        if np.max(np.abs(step)) < 1e-8:
            break
    return w


def predict(w: np.ndarray, X: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-(w[0] + X @ w[1:])))


def auc(y: np.ndarray, p: np.ndarray) -> float:
    """Mann-Whitney U（同順位は平均順位）。"""
    pos = y == 1
    if pos.sum() == 0 or (~pos).sum() == 0:
        return float("nan")
    ranks = pd.Series(p).rank().values
    return float((ranks[pos].sum() - pos.sum() * (pos.sum() + 1) / 2) / (pos.sum() * (~pos).sum()))


def brier(y, p) -> float:
    return float(np.mean((p - y) ** 2))


def calibration(y, p, bins: int = 10) -> list[dict]:
    order = np.argsort(p, kind="mergesort")
    rows = []
    for i, idx in enumerate(np.array_split(order, bins)):
        if len(idx) == 0:
            continue
        rows.append({"bin": i + 1, "n": int(len(idx)), "pred": float(p[idx].mean() * 100), "actual": float(y[idx].mean() * 100)})
    return rows


def calib_spearman(rows: list[dict]) -> float:
    return spearman(pd.Series([r["bin"] for r in rows], dtype=float), pd.Series([r["actual"] for r in rows]))


def is_roughly_monotone(rows: list[dict]) -> bool:
    """概ね単調: 10分位の番号と実績公募割れ率の Spearman ≥ 0.6、かつ 上位3分位の実績平均 > 下位3分位の実績平均。
    1分位あたり 18 件前後のため 1 件で 5pt 以上動く。個々の逆転ではなく傾向で判定する。"""
    act = [r["actual"] for r in rows]
    return calib_spearman(rows) >= 0.6 and np.mean(act[-3:]) > np.mean(act[:3])


def run_split(df, P, feats, train_mask, test_mask, lam=1.0):
    Xtr_raw = P.loc[train_mask, feats].values.astype(float)
    mu = Xtr_raw.mean(axis=0)
    sd = Xtr_raw.std(axis=0)
    sd[sd == 0] = 1.0
    Xtr = (Xtr_raw - mu) / sd
    Xte = (P.loc[test_mask, feats].values.astype(float) - mu) / sd
    ytr = df.loc[train_mask, "break_even"].values
    yte = df.loc[test_mask, "break_even"].values
    w = fit_logistic(Xtr, ytr, lam)
    ptr = predict(w, Xtr)
    pte = predict(w, Xte)
    base = np.full_like(pte, ytr.mean(), dtype=float)
    return {
        "w": w,
        "mu": mu,
        "sd": sd,
        "nTrain": int(len(ytr)),
        "nTest": int(len(yte)),
        "trainRate": float(ytr.mean() * 100),
        "testRate": float(yte.mean() * 100),
        "aucTrain": auc(ytr, ptr),
        "aucTest": auc(yte, pte),
        "brierTest": brier(yte, pte),
        "brierBase": brier(yte, base),
        "calib": calibration(yte, pte),
        "calib5": calibration(yte, pte, 5),
    }


def print_split(title, r, feats):
    print(f"### {title}\n")
    print(f"学習 n={r['nTrain']}（公募割れ率 {r['trainRate']:.1f}%） / 検証 n={r['nTest']}（公募割れ率 {r['testRate']:.1f}%）")
    print(f"AUC 学習 {r['aucTrain']:.3f} / **検証 {r['aucTest']:.3f}**")
    print(f"ブライアスコア 検証 {r['brierTest']:.4f}（学習期間の平均率を一律に当てた基準 {r['brierBase']:.4f}）\n")
    print("| 特徴量 | 係数（標準化後） |")
    print("|---|---|")
    print(f"| 切片 | {r['w'][0]:+.3f} |")
    for f, c in zip(feats, r["w"][1:]):
        print(f"| {f} | {c:+.3f} |")
    print()
    print("キャリブレーション（検証期間、予測確率の10分位）\n")
    print("| 分位 | n | 予測平均 | 実績公募割れ率 |")
    print("|---|---|---|---|")
    for row in r["calib"]:
        print(f"| {row['bin']} | {row['n']} | {row['pred']:.1f}% | {row['actual']:.1f}% |")
    q5 = r["calib5"]
    print("\n5分位（1分位 約36件）: " + " / ".join(f"予測{x['pred']:.0f}%→実績{x['actual']:.0f}%" for x in q5))
    print(f"\n10分位の Spearman(分位, 実績) {calib_spearman(r['calib']):+.2f} → 概ね単調: {'はい' if is_roughly_monotone(r['calib']) else 'いいえ'}\n")


def main() -> None:
    df = load_all()
    ret = df["initial_return"]
    P = compute_points(df)
    P_bb = compute_points(df, recent_col="recent_ipo_avg_bb")
    train_hist = df["year"] <= "2023"

    print("# BB参加スコア v2 / 公募割れ確率 検証結果\n")
    print(f"母数: {len(df)}銘柄（offer/first あり）")
    print("年別: " + ", ".join(f"{y}={n}" for y, n in df["year"].value_counts().sort_index().items()))
    g = v1.group_stats(ret)
    print(f"全体: 平均 {g['mean']:+.1f}% / 中央値 {g['median']:+.1f}% / 公募割れ率 {g['breakEven']:.1f}%\n")

    print("## 0. 新項目の分布（学習期間 2015〜2023 の五分位 20/40/60/80%）\n")
    tr = df[train_hist]
    print(f"- 売出比率(%): {quintiles(tr['sale_ratio'])}（0%=売出なしが {(tr['sale_ratio'] == 0).mean() * 100:.0f}%）")
    print(f"- 幹事団社数: {quintiles(tr['uw_count'])}")
    print(f"- 同週上場件数: {quintiles(tr['same_week'])}")
    print(f"- 直近5件の初値騰落率平均(%): {quintiles(tr['recent_ipo_avg'])}")
    print(f"- 日経25日MA乖離: {quintiles(tr['nikkei_dev'] * 100)}（%）")
    print()
    print("採用した閾値（五分位を丸めた値）:")
    print(f"- 売出比率: <{SALE_RATIO_CUTS[0]:.0f}%=+2 / <{SALE_RATIO_CUTS[1]:.0f}%=+1 / <{SALE_RATIO_CUTS[2]:.0f}%=0 / <{SALE_RATIO_CUTS[3]:.0f}%=-1 / それ以上=-2")
    print(f"- 幹事団社数: <={UW_COUNT_CUTS[0]}社=+2 / <={UW_COUNT_CUTS[1]}=+1 / <={UW_COUNT_CUTS[2]}=0 / <={UW_COUNT_CUTS[3]}=-1 / それ以上=-2")
    print(f"- 同週上場件数: <={SAME_WEEK_CUTS[0]}件=+2 / <={SAME_WEEK_CUTS[1]}=+1 / <={SAME_WEEK_CUTS[2]}=0 / <={SAME_WEEK_CUTS[3]}=-1 / それ以上=-2")
    print(f"- 直近5件IPO平均: >={RECENT_IPO_CUTS[0]:.0f}%=+2 / >={RECENT_IPO_CUTS[1]:.0f}=+1 / >={RECENT_IPO_CUTS[2]:.0f}=0 / >={RECENT_IPO_CUTS[3]:.0f}=-1 / それ未満=-2\n")

    # 1. 項目別相関（全期間）
    coverage = {
        "absorption": df["absorption_amt"].fillna(0) > 0,
        "offeringRatioBb": df["offering_ratio"].fillna(0) > 0,
        "underwriterTrack": df["uw_prior_count"] >= v1.UW_MIN_SAMPLE,
        "priceRangePosition": (df["assumed_price"].fillna(0) > 0) & (df["range_high"].fillna(0) > 0),
        "vcLockup": df["lock_days"].fillna(0) > 0,
        "sentiment": df["nikkei_dev"].notna(),
        "saleRatio": df["sale_ratio"].notna(),
        "underwriterCount": df["uw_count"].fillna(0) > 0,
        "sameWeekListings": df["same_week"] > 0,
        "recentIpoSentiment": df["recent_ipo_avg"].notna(),
    }
    years = sorted(df["year"].unique())
    print("## 1. 項目別 Spearman（points vs 初値騰落率 / points vs 公募割れ）\n")
    print("| 項目 | 取得率 | +2 | +1 | 0 | -1 | -2 | Spearman(騰落率) | Spearman(公募割れ) | 年別 Spearman（" + "/".join(y[2:] for y in years) + "） | 向きが同じ年 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    item_stats = {}
    for k in ALL_KEYS:
        col = P[k]
        vc = col.value_counts()
        sp = spearman(col, ret)
        sp_be = spearman(col, df["break_even"])
        yearly = [spearman(col[df["year"] == y], ret[df["year"] == y]) for y in years]
        sign = np.sign(sp)
        same = sum(1 for v in yearly if not math.isnan(v) and np.sign(v) == sign)
        item_stats[k] = {"spearman": sp, "yearly": yearly, "same": same}
        print(
            f"| {k} | {coverage[k].mean() * 100:.0f}% | "
            + " | ".join(str(int(vc.get(v, 0))) for v in (2, 1, 0, -1, -2))
            + f" | {sp:+.3f} | {sp_be:+.3f} | "
            + " ".join(f"{v:+.2f}" if not math.isnan(v) else "—" for v in yearly)
            + f" | {same}/{len(years)} |"
        )
    print()
    sp_bb = spearman(P_bb["recentIpoSentiment"], ret)
    print(f"参考: 直近IPO地合いを「上場日の{BB_LAG_DAYS}日前まで（BB期間時点で既知）」に限った版の Spearman {sp_bb:+.3f}\n")

    print("### points ごとの初値騰落率中央値 / 公募割れ率（n）\n")
    print("| 項目 | +2 | +1 | 0 | -1 | -2 |")
    print("|---|---|---|---|---|---|")
    for k in ALL_KEYS:
        cells = []
        for v in (2, 1, 0, -1, -2):
            m = P[k] == v
            cells.append(f"{ret[m].median():+.0f}% / {df.loc[m, 'break_even'].mean() * 100:.0f}% ({int(m.sum())})" if m.sum() else "—")
        print(f"| {k} | " + " | ".join(cells) + " |")
    print()

    # 2. 採用判定（新項目）: |Spearman|>=0.10 かつ 年別で同じ向きが 7/12 年以上（NaN の年は除外）
    adopted = []
    for k in NEW_KEYS:
        s = item_stats[k]
        valid_years = sum(1 for v in s["yearly"] if not math.isnan(v))
        ok = abs(s["spearman"]) >= 0.10 and s["spearman"] > 0 and s["same"] >= math.ceil(valid_years * 0.75)
        if ok:
            adopted.append(k)
    print("## 2. 新項目の採用判定\n")
    print("基準: 全期間 Spearman ≥ +0.10（想定どおりの向き）かつ 年別 Spearman の向きが有効年の 75% 以上で一致\n")
    for k in NEW_KEYS:
        s = item_stats[k]
        print(f"- {k}: Spearman {s['spearman']:+.3f}、同じ向きの年 {s['same']}/{len(years)} → {'採用' if k in adopted else '不採用'}")
    print()

    # 3. 地合い: 日経MA版 vs 直近IPO版
    print("## 3. 地合いの比較（スコア全体での上位/下位30%）\n")
    w_nk = dict(CURRENT_WEIGHTS)
    w_ipo = dict(CURRENT_WEIGHTS)
    w_ipo.pop("sentiment")
    w_ipo["recentIpoSentiment"] = 2
    w_both = dict(CURRENT_WEIGHTS)
    w_both["recentIpoSentiment"] = 2
    print("| 構成 | Spearman | 上位 中央値 | 下位 中央値 | 上位 公募割れ率 | 下位 公募割れ率 |")
    print("|---|---|---|---|---|---|")
    variants = {"現行（日経MA地合い）": w_nk, "地合いを直近IPOに置換": w_ipo, "日経MA + 直近IPO": w_both}
    for name, w in variants.items():
        ev = evaluate(P, ret, w)
        t, b = ev["top"], ev["bottom"]
        print(f"| {name} | {ev['spearman']:+.3f} | {t['median']:+.1f}% | {b['median']:+.1f}% | {t['breakEven']:.0f}% | {b['breakEven']:.0f}% |")
    print()

    # 4. 新しい重み（採用項目のみ追加）
    new_weights = dict(CURRENT_WEIGHTS)
    for k in adopted:
        new_weights[k] = 2
    print("## 4. 採用後の重みで比較（全期間・年別）\n")
    print(f"新重み: {json.dumps(new_weights, ensure_ascii=False)}\n")
    print("| 年 | n | 現行 Spearman | 新 Spearman | 現行 上位-下位 中央値差 | 新 上位-下位 中央値差 |")
    print("|---|---|---|---|---|---|")
    for y in years + ["全期間"]:
        m = df["year"] == y if y != "全期間" else pd.Series(True, index=df.index)
        e0 = evaluate(P[m], ret[m], CURRENT_WEIGHTS)
        e1 = evaluate(P[m], ret[m], new_weights)
        print(
            f"| {y} | {int(m.sum())} | {e0['spearman']:+.3f} | {e1['spearman']:+.3f} | "
            f"{e0['top']['median'] - e0['bottom']['median']:+.1f}pt | {e1['top']['median'] - e1['bottom']['median']:+.1f}pt |"
        )
    print()

    print("### 追加項目の重み感度（全期間 Spearman / 2024〜 Spearman）\n")
    print("| 重み | 全期間 | 2024〜 |")
    print("|---|---|---|")
    recent = df["year"] >= "2024"
    for wv in (1, 2, 3):
        w = dict(CURRENT_WEIGHTS)
        for k in adopted:
            w[k] = wv
        print(f"| 追加項目={wv} | {evaluate(P, ret, w)['spearman']:+.3f} | {evaluate(P[recent], ret[recent], w)['spearman']:+.3f} |")
    print()

    # 5. ロジスティック回帰
    print("## 5. ロジスティック回帰（目的変数: 公募割れ=1、特徴量: 各項目 points を学習期間で標準化、L2 λ=1、ニュートン法）\n")
    feats_nk = OLD_KEYS + ["saleRatio", "underwriterCount", "sameWeekListings"]
    feats_ipo = [k for k in feats_nk if k != "sentiment"] + ["recentIpoSentiment"]
    feats_both = feats_nk + ["recentIpoSentiment"]
    feat_sets = {"日経MA地合い": feats_nk, "直近IPO地合い": feats_ipo, "両方": feats_both}
    test_main = df["year"] >= "2024"
    train_2022 = df["year"] <= "2022"
    test_2023 = df["year"] == "2023"
    results = {}
    print("| 特徴量セット | 検証2024〜 AUC | ブライア | 検証2023 AUC | ブライア |")
    print("|---|---|---|---|---|")
    for name, feats in feat_sets.items():
        r1 = run_split(df, P, feats, train_hist, test_main)
        r2 = run_split(df, P, feats, train_2022, test_2023)
        results[name] = (r1, r2, feats)
        print(f"| {name} | {r1['aucTest']:.3f} | {r1['brierTest']:.4f}（基準 {r1['brierBase']:.4f}） | {r2['aucTest']:.3f} | {r2['brierTest']:.4f}（基準 {r2['brierBase']:.4f}） |")
    # BB時点版の直近IPO
    r_bb = run_split(df, P_bb, feats_ipo, train_hist, test_main)
    print(f"| 直近IPO地合い（BB期間時点で既知の実績のみ） | {r_bb['aucTest']:.3f} | {r_bb['brierTest']:.4f} | — | — |")
    # 学習は上場日版、検証だけ BB期間時点版（アプリで BB 期間中に見るときの条件）
    mix = P.copy()
    mix.loc[test_main, "recentIpoSentiment"] = P_bb.loc[test_main, "recentIpoSentiment"]
    r_mix = run_split(df, mix, feats_ipo, train_hist, test_main)
    print(f"| 直近IPO地合い（学習=上場日前、検証=BB期間時点） | {r_mix['aucTest']:.3f} | {r_mix['brierTest']:.4f} | — | — |")
    # λ感度
    for lam in (0.1, 10.0):
        r = run_split(df, P, feats_ipo, train_hist, test_main, lam)
        print(f"| 直近IPO地合い λ={lam} | {r['aucTest']:.3f} | {r['brierTest']:.4f} | — | — |")
    print()

    # 採用候補は「日経MA」と「直近IPO」の2択（両方版は参考。アプリの地合い設定は日経MA単独と一致しないため）
    best_name = max(["日経MA地合い", "直近IPO地合い"], key=lambda n: results[n][0]["aucTest"] + results[n][1]["aucTest"])
    print(f"日経MA版と直近IPO版のうち、2 つの検証期間の AUC 合計が高い構成: **{best_name}**\n")
    for name in feat_sets:
        r1, r2, feats = results[name]
        print_split(f"{name}: 学習 2015〜2023 → 検証 2024〜2026", r1, feats)
        if name == best_name:
            print_split(f"{name}: 学習 2015〜2022 → 検証 2023", r2, feats)

    r1, r2, feats = results[best_name]
    adopt_model = r1["aucTest"] >= 0.65 and is_roughly_monotone(r1["calib"])
    print("## 6. 確率表示の採用判定\n")
    print(f"基準: 検証 2024〜 AUC ≥ 0.65 かつ キャリブレーション概ね単調 → {'採用' if adopt_model else '不採用'}")
    print(f"（AUC {r1['aucTest']:.3f}、単調 {'はい' if is_roughly_monotone(r1['calib']) else 'いいえ'}）\n")

    if adopt_model and os.environ.get("WRITE_MODEL") == "1":
        # 本番係数は 2015〜2023 で学習したもの（検証で評価した係数そのもの）
        model = {
            "version": 1,
            "target": "公募割れ（初値 < 公開価格）",
            "trainedFrom": "2015-01-01",
            "trainedThrough": "2023-12-31",
            "sampleCount": r1["nTrain"],
            "trainBreakEvenRate": round(r1["trainRate"], 2),
            "validation": {
                "period": "2024-01〜2026-07",
                "sampleCount": r1["nTest"],
                "auc": round(r1["aucTest"], 3),
                "brier": round(r1["brierTest"], 4),
                "brierBaseline": round(r1["brierBase"], 4),
            },
            "lambda": 1.0,
            "intercept": round(float(r1["w"][0]), 6),
            "features": [
                {"key": f, "coef": round(float(c), 6), "mean": round(float(m), 6), "sd": round(float(s), 6)}
                for f, c, m, s in zip(feats, r1["w"][1:], r1["mu"], r1["sd"])
            ],
            "featureDefinition": "各特徴量は BB参加スコアの項目 points（-2〜+2、未取得は 0）。z=(points-mean)/sd、p=1/(1+exp(-(intercept+Σcoef·z)))。",
            "thresholds": {
                "saleRatio": list(SALE_RATIO_CUTS),
                "underwriterCount": list(UW_COUNT_CUTS),
                "sameWeekListings": list(SAME_WEEK_CUTS),
                "recentIpoSentiment": list(RECENT_IPO_CUTS),
                "recentIpoCount": RECENT_N,
            },
            "source": "scratch/backtest/recalibrate_bb_v2.py / report-phase3.md",
        }
        MODEL_JSON.write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"係数出力: {MODEL_JSON}\n")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    panel = df[["code", "name", "listing_date", "year", "initial_return", "break_even", "sale_ratio", "uw_count", "same_week", "recent_ipo_avg", "recent_ipo_avg_bb", "nikkei_dev"]].copy()
    for k in ALL_KEYS:
        panel[f"pt_{k}"] = P[k]
    panel.to_csv(OUT_DIR / "bb_score_panel_v2.csv", index=False)
    summary = {
        "n": int(len(df)),
        "items": {k: {"spearman": item_stats[k]["spearman"], "sameYears": item_stats[k]["same"]} for k in ALL_KEYS},
        "adoptedNewItems": adopted,
        "newWeights": new_weights,
        "bestFeatureSet": best_name,
        "models": {n: {"aucTest2024": results[n][0]["aucTest"], "aucTest2023": results[n][1]["aucTest"], "brier2024": results[n][0]["brierTest"]} for n in feat_sets},
        "adoptModel": bool(adopt_model),
    }
    (OUT_DIR / "bb_v2_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"パネル出力: {OUT_DIR / 'bb_score_panel_v2.csv'} / サマリ: {OUT_DIR / 'bb_v2_summary.json'}")


if __name__ == "__main__":
    main()
