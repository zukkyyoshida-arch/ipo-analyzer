"""BB参加スコア（src/lib/scoring/bb.ts）の重み再校正バックテスト。

設計書 scratch/phase2/design.md §3.4 の手順を実行する。
- data/ipo_list.csv + data/fundamentals.csv + public/data/ipos.enriched.json を code で JOIN
- offer/first price が揃う銘柄で initial_return を目的変数にする
- bb.ts の6項目の points を同じ閾値で Python に再実装して算出
- 主幹事別公募割れ率は leave-one-out（自分を除いた実績）で points 化（リーク回避）
- 地合いは上場日前営業日の日経平均 25日MA乖離で strong/neutral/weak を近似
- 相関・上位30% vs 下位30%・年別安定性・重み ±1 近傍グリッドを出力

実行: cd scratch/backtest && ./venv/bin/python recalibrate_bb.py
標準ライブラリ + 既存 venv の pandas/numpy のみ使用。
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ENRICHED = HERE.parent.parent / "public" / "data" / "ipos.enriched.json"
OUT_DIR = DATA / "out"

KEYS = [
    "absorption",
    "offeringRatioBb",
    "underwriterTrack",
    "priceRangePosition",
    "vcLockup",
    "sentiment",
]

# 設計書 §3.2 の暫定重み。検証後の確定値（underwriterTrack 3→2）は bb.ts の DEFAULT_BB_WEIGHTS。
PROVISIONAL_WEIGHTS = {
    "absorption": 4,
    "offeringRatioBb": 4,
    "underwriterTrack": 3,
    "priceRangePosition": 3,
    "vcLockup": 2,
    "sentiment": 2,
}

# 主幹事実績を points 化する最小母数（bb.ts の UNDERWRITER_MIN_SAMPLE と同じ）
UW_MIN_SAMPLE = 5
# 地合い近似の閾値（日経平均の25日MA乖離率）
SENTIMENT_DEV_THRESHOLD = 0.02


# ---------------------------------------------------------------------------
# 6項目の points（bb.ts / scoring/items.ts と同じ閾値）
# ---------------------------------------------------------------------------

def pts_absorption(a: float | None) -> int:
    """scoreAbsorption: <10=+2 / <30=+1 / <100=0 / <500=-1 / それ以上=-2。未取得(0以下)は0。"""
    if a is None or not (a > 0):
        return 0
    if a < 10:
        return 2
    if a < 30:
        return 1
    if a < 100:
        return 0
    if a < 500:
        return -1
    return -2


def pts_offering_ratio(r: float | None) -> int:
    """scoreOfferingRatioBb: <10=+2 / <20=+1 / <30=0 / <50=-1 / それ以上=-2。未取得(0以下)は0。"""
    if r is None or not (r > 0):
        return 0
    if r < 10:
        return 2
    if r < 20:
        return 1
    if r < 30:
        return 0
    if r < 50:
        return -1
    return -2


def pts_underwriter(count: int, break_even_rate: float | None) -> int:
    """scoreUnderwriterTrack: 母数5未満は0。公募割れ率 <5=+2 / <10=+1 / <20=0 / <30=-1 / それ以上=-2。"""
    if count < UW_MIN_SAMPLE or break_even_rate is None:
        return 0
    if break_even_rate < 5:
        return 2
    if break_even_rate < 10:
        return 1
    if break_even_rate < 20:
        return 0
    if break_even_rate < 30:
        return -1
    return -2


def pts_price_range(assumed: float | None, low: float | None, high: float | None) -> int:
    """checkPriceRangeRevision と同じ境界: 上振れ(low>想定)=+2 / 下振れ(high<想定)=-2 / レンジ内=0 / 未取得=0。"""
    if assumed is None or low is None or high is None:
        return 0
    if not (assumed > 0) or not (high > 0):
        return 0
    if low > assumed:
        return 2
    if high < assumed:
        return -2
    return 0


VC_LOCKUP_MATRIX = {
    "low": {"strong": 2, "medium": 1, "weak": 0},
    "mid": {"strong": 1, "medium": 0, "weak": -1},
    "high": {"strong": 0, "medium": -1, "weak": -2},
}


def pts_vc_lockup(vc: float | None, days: float | None, has15x: bool | None) -> int:
    """scoreVcLockup と同じマトリクス。ロックアップ日数が未取得(0以下/欠損)なら0。"""
    if days is None or not (days > 0) or vc is None or math.isnan(vc):
        return 0
    has15x = bool(has15x) if has15x is not None else False
    if days >= 180 and not has15x:
        lock = "strong"
    elif days < 90:
        lock = "weak"
    else:
        lock = "medium"
    if vc < 10:
        bucket = "low"
    elif vc <= 30:
        bucket = "mid"
    else:
        bucket = "high"
    return VC_LOCKUP_MATRIX[bucket][lock]


def pts_sentiment(label: str) -> int:
    return {"strong": 2, "neutral": 0, "weak": -2}[label]


# ---------------------------------------------------------------------------
# データ読み込み・JOIN
# ---------------------------------------------------------------------------

def _num(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def load_frame() -> pd.DataFrame:
    ipo = pd.read_csv(DATA / "ipo_list.csv", dtype={"code": str})
    fund = pd.read_csv(DATA / "fundamentals.csv", dtype={"code": str})
    enriched = json.loads(ENRICHED.read_text(encoding="utf-8"))
    enr = {r["code"]: r for r in enriched}

    df = ipo.merge(fund, on="code", how="left", suffixes=("", "_f"))
    df = df[df["offer_price"].notna() & df["first_price"].notna()].copy()
    df = df[df["offer_price"] > 0].copy()
    df["initial_return"] = (df["first_price"] - df["offer_price"]) / df["offer_price"] * 100
    df["year"] = df["listing_date"].str[:4]

    rows = []
    for _, r in df.iterrows():
        e = enr.get(r["code"], {})
        # 吸収金額: fundamentals → ipo_list → enriched（アプリの base 優先に近い順）
        absorption = _num(r.get("absorption_oku_f"))
        if absorption is None:
            absorption = _num(r.get("absorption_oku"))
        if absorption is None:
            absorption = _num(e.get("absorptionAmount"))
        pr = e.get("priceRange") or {}
        lockup = e.get("lockup") or {}
        vc = _num(r.get("vc_ratio"))
        if vc is None:
            vc = _num(e.get("vcRatio"))
        days = _num(r.get("lockup_days"))
        if days is None:
            days = _num(lockup.get("days"))
        has15x = r.get("lockup_has_15x")
        if has15x is None or (isinstance(has15x, float) and math.isnan(has15x)):
            has15x = lockup.get("hasPriceRelease")
        elif isinstance(has15x, str):
            has15x = has15x.strip().lower() == "true"
        rows.append(
            {
                "code": r["code"],
                "absorption_amt": absorption,
                "offering_ratio": _num(e.get("offeringRatio")),
                "assumed_price": _num(e.get("assumedPrice")),
                "range_low": _num(pr.get("low")),
                "range_high": _num(pr.get("high")),
                "vc": vc,
                "lock_days": days,
                "lock_15x": has15x,
                "in_enriched": r["code"] in enr,
            }
        )
    extra = pd.DataFrame(rows)
    df = df.merge(extra, on="code", how="left")
    return df.sort_values(["listing_date", "code"]).reset_index(drop=True)


def attach_sentiment(df: pd.DataFrame, threshold: float = SENTIMENT_DEV_THRESHOLD) -> pd.Series:
    """上場日前営業日の日経平均終値の 25日MA 乖離で地合いを近似する。"""
    nk = pd.read_csv(DATA / "nikkei.csv", parse_dates=["Date"]).sort_values("Date")
    nk["ma25"] = nk["Close"].rolling(25).mean()
    nk["dev"] = (nk["Close"] - nk["ma25"]) / nk["ma25"]
    labels = []
    devs = []
    for d in pd.to_datetime(df["listing_date"]):
        prior = nk[nk["Date"] < d]
        dev = prior["dev"].iloc[-1] if len(prior) else float("nan")
        devs.append(dev)
        if isinstance(dev, float) and math.isnan(dev):
            labels.append("neutral")
        elif dev > threshold:
            labels.append("strong")
        elif dev < -threshold:
            labels.append("weak")
        else:
            labels.append("neutral")
    df["nikkei_dev"] = devs
    return pd.Series(labels, index=df.index)


def underwriter_loo(df: pd.DataFrame, prior_only: bool = False) -> tuple[list[int], list[float | None]]:
    """主幹事別公募割れ率を leave-one-out（prior_only=True なら上場日が前の銘柄だけ）で計算。"""
    counts: list[int] = []
    rates: list[float | None] = []
    for i, r in df.iterrows():
        mask = (df["lead_underwriter"] == r["lead_underwriter"]) & (df.index != i)
        if prior_only:
            mask &= df["listing_date"] < r["listing_date"]
        peers = df.loc[mask, "initial_return"]
        n = int(len(peers))
        counts.append(n)
        rates.append(float((peers < 0).mean() * 100) if n > 0 else None)
    return counts, rates


def compute_points(df: pd.DataFrame, uw_prior_only: bool = False, sent_threshold: float = SENTIMENT_DEV_THRESHOLD) -> pd.DataFrame:
    p = pd.DataFrame(index=df.index)
    p["absorption"] = [pts_absorption(v) for v in df["absorption_amt"]]
    p["offeringRatioBb"] = [pts_offering_ratio(v) for v in df["offering_ratio"]]
    counts, rates = underwriter_loo(df, prior_only=uw_prior_only)
    df["uw_count"] = counts
    df["uw_break_even_rate"] = rates
    p["underwriterTrack"] = [pts_underwriter(c, r) for c, r in zip(counts, rates)]
    p["priceRangePosition"] = [
        pts_price_range(a, lo, hi) for a, lo, hi in zip(df["assumed_price"], df["range_low"], df["range_high"])
    ]
    p["vcLockup"] = [pts_vc_lockup(v, d, h) for v, d, h in zip(df["vc"], df["lock_days"], df["lock_15x"])]
    df["sentiment"] = attach_sentiment(df, sent_threshold)
    p["sentiment"] = [pts_sentiment(s) for s in df["sentiment"]]
    return p


def score(points: pd.DataFrame, weights: dict[str, int]) -> pd.Series:
    """buildAxis と同じ 0〜100 換算（全重み0なら50）。"""
    total_w = sum(weights[k] for k in KEYS)
    if total_w == 0:
        return pd.Series(50, index=points.index)
    raw = sum(points[k] * weights[k] for k in KEYS)
    s = (raw + 2 * total_w) / (4 * total_w) * 100
    # JS の Math.round と同じ四捨五入（pandas の round は偶数丸めのため使わない）
    return np.floor(s + 0.5).clip(0, 100)


# ---------------------------------------------------------------------------
# 評価指標
# ---------------------------------------------------------------------------

def spearman(x: pd.Series, y: pd.Series) -> float:
    if x.nunique() < 2 or y.nunique() < 2:
        return float("nan")
    return float(x.rank().corr(y.rank()))


def pearson(x: pd.Series, y: pd.Series) -> float:
    if x.nunique() < 2 or y.nunique() < 2:
        return float("nan")
    return float(x.corr(y))


def group_stats(ret: pd.Series) -> dict:
    return {
        "n": int(len(ret)),
        "mean": float(ret.mean()) if len(ret) else float("nan"),
        "median": float(ret.median()) if len(ret) else float("nan"),
        "win": float((ret > 0).mean() * 100) if len(ret) else float("nan"),
        "breakEven": float((ret < 0).mean() * 100) if len(ret) else float("nan"),
    }


def top_bottom(s: pd.Series, ret: pd.Series, frac: float = 0.3) -> tuple[dict, dict]:
    """スコア降順で上位 frac / 下位 frac を比較。同点は code 順で決定的に並べる（安定ソート）。"""
    order = s.sort_values(ascending=False, kind="mergesort").index
    n = max(1, int(round(len(order) * frac)))
    top = ret.loc[order[:n]]
    bottom = ret.loc[order[-n:]]
    return group_stats(top), group_stats(bottom)


def evaluate(points: pd.DataFrame, ret: pd.Series, weights: dict[str, int]) -> dict:
    s = score(points, weights)
    top, bot = top_bottom(s, ret)
    return {
        "spearman": spearman(s, ret),
        "top": top,
        "bottom": bot,
        "diffMean": top["mean"] - bot["mean"],
        "diffMedian": top["median"] - bot["median"],
        "diffWin": top["win"] - bot["win"],
    }


def fmt(v: float, digits: int = 1) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—"
    return f"{v:+.{digits}f}" if digits else f"{v:.0f}"


def print_eval(title: str, ev: dict) -> None:
    t, b = ev["top"], ev["bottom"]
    print(f"### {title}")
    print(f"スコアとのSpearman: {ev['spearman']:+.3f}")
    print("| 群 | n | 平均 | 中央値 | 初値超え率 | 公募割れ率 |")
    print("|---|---|---|---|---|---|")
    print(f"| 上位30% | {t['n']} | {t['mean']:+.1f}% | {t['median']:+.1f}% | {t['win']:.0f}% | {t['breakEven']:.0f}% |")
    print(f"| 下位30% | {b['n']} | {b['mean']:+.1f}% | {b['median']:+.1f}% | {b['win']:.0f}% | {b['breakEven']:.0f}% |")
    print(f"| 差 | | {ev['diffMean']:+.1f}pt | {ev['diffMedian']:+.1f}pt | {ev['diffWin']:+.0f}pt | |")
    print()


def main() -> None:
    df = load_frame()
    ret = df["initial_return"]
    points = compute_points(df)

    print("# BB参加スコア 再校正バックテスト結果\n")
    print(f"母数: {len(df)}銘柄（offer/first price あり） / enriched 一致 {int(df['in_enriched'].sum())}件")
    print("年別: " + ", ".join(f"{y}={n}" for y, n in df["year"].value_counts().sort_index().items()))
    base = group_stats(ret)
    print(f"全体: 平均 {base['mean']:+.1f}% / 中央値 {base['median']:+.1f}% / 初値超え率 {base['win']:.0f}% / 公募割れ率 {base['breakEven']:.0f}%\n")

    # 1. 項目別相関
    print("## 1. 項目別相関（points vs initial_return）\n")
    print("| 項目 | 取得率 | +2 | +1 | 0 | -1 | -2 | Pearson | Spearman | 非0のみSpearman |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    item_rows = {}
    coverage = {
        "absorption": df["absorption_amt"].fillna(0) > 0,
        "offeringRatioBb": df["offering_ratio"].fillna(0) > 0,
        "underwriterTrack": df["uw_count"] >= UW_MIN_SAMPLE,
        "priceRangePosition": (df["assumed_price"].fillna(0) > 0) & (df["range_high"].fillna(0) > 0),
        "vcLockup": df["lock_days"].fillna(0) > 0,
        "sentiment": df["nikkei_dev"].notna(),
    }
    for k in KEYS:
        col = points[k]
        vc = col.value_counts()
        nz = col != 0
        sp_nz = spearman(col[nz], ret[nz]) if nz.sum() > 2 else float("nan")
        item_rows[k] = {"pearson": pearson(col, ret), "spearman": spearman(col, ret)}
        print(
            f"| {k} | {coverage[k].mean() * 100:.0f}% | "
            + " | ".join(str(int(vc.get(v, 0))) for v in (2, 1, 0, -1, -2))
            + f" | {item_rows[k]['pearson']:+.3f} | {item_rows[k]['spearman']:+.3f} | {sp_nz:+.3f} |"
        )
    print()

    # 項目別の points ごとの中央値（方向の確認）
    print("### 項目別 points ごとの初値騰落率中央値（n）\n")
    print("| 項目 | +2 | +1 | 0 | -1 | -2 |")
    print("|---|---|---|---|---|---|")
    for k in KEYS:
        cells = []
        for v in (2, 1, 0, -1, -2):
            sub = ret[points[k] == v]
            cells.append(f"{sub.median():+.0f}% ({len(sub)})" if len(sub) else "—")
        print(f"| {k} | " + " | ".join(cells) + " |")
    print()

    # 2. 暫定重みでの上位/下位
    print("## 2. 暫定重み（設計書 §3.2）での上位30% vs 下位30%\n")
    ev0 = evaluate(points, ret, PROVISIONAL_WEIGHTS)
    print_eval("暫定重み " + json.dumps(PROVISIONAL_WEIGHTS), ev0)

    # 3. 年別安定性
    print("## 3. 年別安定性（年ごとに上位/下位30%を切り直す）\n")
    print("| 年 | n | Spearman | 上位平均 | 下位平均 | 上位中央値 | 下位中央値 | 上位初値超え率 | 下位初値超え率 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for y in sorted(df["year"].unique()):
        m = df["year"] == y
        ev = evaluate(points[m], ret[m], PROVISIONAL_WEIGHTS)
        t, b = ev["top"], ev["bottom"]
        print(
            f"| {y} | {int(m.sum())} | {ev['spearman']:+.3f} | {t['mean']:+.1f}% | {b['mean']:+.1f}% | "
            f"{t['median']:+.1f}% | {b['median']:+.1f}% | {t['win']:.0f}% | {b['win']:.0f}% |"
        )
    print()

    # 4. 近傍グリッド（各重み ±1）
    print("## 4. 近傍グリッド（各重みを ±1、下限0）\n")
    print("| 変更 | Spearman | 上位-下位 平均差 | 中央値差 | 初値超え率差 |")
    print("|---|---|---|---|---|")
    print(f"| 暫定（基準） | {ev0['spearman']:+.3f} | {ev0['diffMean']:+.1f}pt | {ev0['diffMedian']:+.1f}pt | {ev0['diffWin']:+.0f}pt |")
    for k in KEYS:
        for delta in (-1, 1):
            w = dict(PROVISIONAL_WEIGHTS)
            w[k] = max(0, w[k] + delta)
            if w[k] == PROVISIONAL_WEIGHTS[k]:
                continue
            ev = evaluate(points, ret, w)
            print(f"| {k} {delta:+d} | {ev['spearman']:+.3f} | {ev['diffMean']:+.1f}pt | {ev['diffMedian']:+.1f}pt | {ev['diffWin']:+.0f}pt |")
    print()

    # 5. §3.4 の規律: 弱い項目（Spearman < 0.10 または符号が逆）を1段階だけ下げて再検証
    weak = [k for k in KEYS if not (item_rows[k]["spearman"] >= 0.10)]
    print("## 5. §3.4 規律による1回だけの保守的調整\n")
    print(f"弱い項目（Spearman < +0.10）: {', '.join(weak) if weak else 'なし'}\n")
    if weak:
        adjusted = dict(PROVISIONAL_WEIGHTS)
        for k in weak:
            adjusted[k] = max(0, adjusted[k] - 1)
        ev1 = evaluate(points, ret, adjusted)
        print_eval("調整後 " + json.dumps(adjusted), ev1)
        print("年別（調整後）\n")
        print("| 年 | n | Spearman | 上位平均 | 下位平均 | 上位中央値 | 下位中央値 |")
        print("|---|---|---|---|---|---|---|")
        for y in sorted(df["year"].unique()):
            m = df["year"] == y
            ev = evaluate(points[m], ret[m], adjusted)
            t, b = ev["top"], ev["bottom"]
            print(f"| {y} | {int(m.sum())} | {ev['spearman']:+.3f} | {t['mean']:+.1f}% | {b['mean']:+.1f}% | {t['median']:+.1f}% | {b['median']:+.1f}% |")
        print()

    # 6. 感度分析（前提を変えても結論が変わらないか）
    print("## 6. 感度分析\n")
    print("| 前提 | Spearman | 平均差 | 中央値差 | 初値超え率差 |")
    print("|---|---|---|---|---|")
    df2 = load_frame()
    p2 = compute_points(df2, uw_prior_only=True)
    ev = evaluate(p2, df2["initial_return"], PROVISIONAL_WEIGHTS)
    print(f"| 主幹事実績を上場日より前の銘柄だけで計算 | {ev['spearman']:+.3f} | {ev['diffMean']:+.1f}pt | {ev['diffMedian']:+.1f}pt | {ev['diffWin']:+.0f}pt |")
    df3 = load_frame()
    p3 = compute_points(df3, sent_threshold=0.005)
    ev = evaluate(p3, df3["initial_return"], PROVISIONAL_WEIGHTS)
    print(f"| 地合い閾値を ±0.5%（アプリのトレンド閾値） | {ev['spearman']:+.3f} | {ev['diffMean']:+.1f}pt | {ev['diffMedian']:+.1f}pt | {ev['diffWin']:+.0f}pt |")
    for frac in (0.2, 0.5):
        s = score(points, PROVISIONAL_WEIGHTS)
        t, b = top_bottom(s, ret, frac)
        print(f"| 上位/下位を {int(frac * 100)}% で切る | — | {t['mean'] - b['mean']:+.1f}pt | {t['median'] - b['median']:+.1f}pt | {t['win'] - b['win']:+.0f}pt |")
    print()

    # 7. 項目間の相関（サンプル内で項目同士が重なっていないか）
    print("## 7. 項目間の相関（points 同士の Spearman）\n")
    print("| | " + " | ".join(KEYS) + " |")
    print("|---|" + "---|" * len(KEYS))
    for a in KEYS:
        print(f"| {a} | " + " | ".join(f"{spearman(points[a], points[b]):+.2f}" for b in KEYS) + " |")
    print()

    # 8. ブートストラップ（銘柄を復元抽出 1000 回、seed 固定）
    print("## 8. ブートストラップ（1000回・seed=20260925）\n")
    adjusted = dict(PROVISIONAL_WEIGHTS)
    for k in weak:
        adjusted[k] = max(0, adjusted[k] - 1)
    rng = np.random.default_rng(20260925)
    s0 = score(points, PROVISIONAL_WEIGHTS)
    s1 = score(points, adjusted)
    med_diff0, sp0, sp1 = [], [], []
    idx = np.arange(len(df))
    for _ in range(1000):
        pick = rng.choice(idx, size=len(idx), replace=True)
        r = ret.iloc[pick].reset_index(drop=True)
        a0 = s0.iloc[pick].reset_index(drop=True)
        a1 = s1.iloc[pick].reset_index(drop=True)
        t, b = top_bottom(a0, r)
        med_diff0.append(t["median"] - b["median"])
        sp0.append(spearman(a0, r))
        sp1.append(spearman(a1, r))
    med_diff0 = np.array(med_diff0)
    sp0 = np.array(sp0)
    sp1 = np.array(sp1)
    print(f"暫定重み 上位-下位 中央値差: 95%区間 {np.percentile(med_diff0, 2.5):+.1f}〜{np.percentile(med_diff0, 97.5):+.1f}pt（0以下になった割合 {(med_diff0 <= 0).mean() * 100:.1f}%）")
    print(f"暫定重み Spearman: 95%区間 {np.percentile(sp0, 2.5):+.3f}〜{np.percentile(sp0, 97.5):+.3f}")
    print(f"調整後 − 暫定 の Spearman 差: 平均 {np.mean(sp1 - sp0):+.4f} / 調整後が上回った割合 {(sp1 > sp0).mean() * 100:.0f}%")
    print()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = df[["code", "name", "listing_date", "year", "initial_return"]].copy()
    for k in KEYS:
        out[f"pt_{k}"] = points[k]
    out["score_provisional"] = score(points, PROVISIONAL_WEIGHTS)
    out.to_csv(OUT_DIR / "bb_score_panel.csv", index=False)
    print(f"パネル出力: {OUT_DIR / 'bb_score_panel.csv'}")


if __name__ == "__main__":
    main()
