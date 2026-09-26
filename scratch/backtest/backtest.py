"""Apollo IPO推奨ルールのウォークフォワード検証エンジン。

各営業日tについて「tまでに入手可能な情報」だけでシグナルを再現し、
翌営業日の寄付で買った場合の成績（5/20/60営業日リターン、TP/SL到達）を測定する。

入力:
  data/ipo_list.csv       code,name,listing_date,offer_price,first_price,...
  data/fundamentals.csv   code,vc_ratio,sales_growth,is_profitable,lockup_days,
                          lockup_has_15x,mcap_offer_oku,lead_underwriter
  data/prices/{code}.csv  Open,High,Low,Close,Volume,split_factor
  data/nikkei.csv         Close
出力:
  data/out/panel.csv          全銘柄×全日のシグナル・スコアパネル
  data/out/trades_*.csv       ルール別トレード一覧
  data/out/summary.json       集計結果
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import rules

BASE = Path(__file__).parent
OUT = BASE / "data" / "out"
OUT.mkdir(parents=True, exist_ok=True)

HORIZONS = [5, 20, 60]
UNIVERSE_YEARS = 2  # アプリ既定の「直近2年以内」フィルタ


def load_stock(code: str) -> pd.DataFrame | None:
    path = BASE / "data" / "prices" / f"{code}.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    df = df[df["Close"].notna() & (df["Close"] > 0)].copy()
    # Yahooの異常プレースホルダ行（例: 8303初日の553億円・出来高0）を除去
    med = df["Close"].median()
    bad = (df["Close"] > med * 50) | (df["Close"] < med / 50)
    df = df[~bad]
    return df if len(df) >= 2 else None


def build_stock_panel(code: str, meta: pd.Series, nikkei_pts: pd.Series) -> pd.DataFrame | None:
    """1銘柄の日次パネル（シグナル・スコア・先行リターン）を構築する。"""
    px = load_stock(code)
    if px is None:
        return None

    offer = meta["offer_price"]
    first = meta["first_price"]
    if pd.isna(first) or not first:
        first = px["Open"].iloc[0]
    if pd.isna(offer) or not offer:
        return None

    n = np.arange(1, len(px) + 1)
    # yfinanceの価格は全履歴が現在の分割スケールに調整済みのため、
    # 公募価格・初値を「総分割係数」で現在スケールへ換算して比較する
    total_factor = float(px["split_factor"].ffill().fillna(1.0).iloc[-1])
    offer_adj = pd.Series(offer / total_factor, index=px.index)
    initial_adj = pd.Series(first / total_factor, index=px.index)

    close, vol, low = px["Close"], px["Volume"], px["Low"]
    day_chg = (close / close.shift(1) - 1.0) * 100

    # --- テクニカル（app.pyの各関数と同値になるよう全系列を一括計算） ---
    delta = close.diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rsi = (100 - 100 / (1 + gain / loss)).fillna(50)
    rsi = pd.Series(np.where(n < 14, 50.0, rsi), index=px.index)  # len<period → 50

    vol5_prev = vol.shift(1).rolling(5).mean()
    price_up = close > close.shift(1)
    volume_alert = (n >= 6) & (vol5_prev > 0) & (vol >= vol5_prev * 2.0) & price_up & (rsi <= 38.0)
    rsi_gold = pd.Series(np.where(n >= 6, rsi, 50.0), index=px.index)

    ma25 = np.where(n < 25, close.expanding().mean(), close.rolling(25).mean())
    above_ma25 = (n >= 3) & (close.values > ma25)
    vol_growing = (n >= 3) & (vol > vol.shift(1))
    recent_low = low.rolling(10, min_periods=1).min()

    # --- 静的属性 ---
    mcap_oku = meta.get("mcap_offer_oku")
    shares0 = (mcap_oku * 1e8 / offer) if pd.notna(mcap_oku) and mcap_oku else np.nan
    mcap = shares0 * total_factor * close  # 円（調整済み終値×現在スケール株数）
    vc = meta.get("vc_ratio")
    growth = meta.get("sales_growth")
    profitable = meta.get("is_profitable")
    profitable = bool(profitable) if pd.notna(profitable) else None
    lockup_days = meta.get("lockup_days")
    uw_major = rules.is_major_underwriter(meta.get("lead_underwriter"))

    df = pd.DataFrame({
        "code": code, "date": px.index, "n_day": n,
        "close": close.values, "open": px["Open"].values,
        "high": px["High"].values, "low": low.values, "volume": vol.values,
        "offer_adj": offer_adj.values, "initial_adj": initial_adj.values,
        "day_chg": day_chg.values, "mcap": (mcap.values if hasattr(mcap, "values") else np.nan),
        "rsi": rsi.values, "volume_alert": np.asarray(volume_alert),
        "above_ma25": above_ma25, "vol_growing": np.asarray(vol_growing),
        "recent_low": recent_low.values,
    })

    # --- スコア（デプロイ実挙動版）---
    env = nikkei_pts.reindex(px.index).ffill().fillna(14)
    scores, grades = [], []
    for i in range(len(df)):
        r = df.iloc[i]
        sc = rules.notebooklm_score(
            initial_price=r["initial_adj"], offering_price=r["offer_adj"],
            close=r["close"], volume=r["volume"],
            day_pct_change=0.0 if np.isnan(r["day_chg"]) else r["day_chg"],
            market_cap=r["mcap"] if not np.isnan(r["mcap"]) else 200e8,  # 不明時は中間区分
            sales_growth=growth if pd.notna(growth) else None,
            vc_ratio=vc if pd.notna(vc) else None,
            lockup_days=int(lockup_days) if pd.notna(lockup_days) else None,
            days_since_listing=int(r["n_day"]),
            underwriter_major=uw_major, env_points=int(env.iloc[i]),
        )
        scores.append(sc["score"])
        grades.append(sc["grade"])
    df["score"] = scores
    df["grade"] = grades
    df["mcap_known"] = pd.notna(mcap_oku) and bool(mcap_oku)

    # --- シグナル ---
    has_fund = pd.notna(vc) and pd.notna(growth) and pd.notna(profitable)
    if has_fund and df["mcap_known"].iloc[0]:
        gold_base = (vc <= 15.0) and (growth >= 20.0) and profitable
        df["sig_gold"] = gold_base & (df["mcap"] <= 150e8) & (
            (df["close"] < df["offer_adj"]) | (rsi_gold.values <= 38.0) | df["volume_alert"])
        solid_base = (vc <= 20.0) and (growth >= 35.0) and profitable
        df["sig_solid"] = solid_base & df["mcap"].between(100e8, 500e8) & (
            df["above_ma25"] | df["vol_growing"])
    else:
        df["sig_gold"] = False
        df["sig_solid"] = False
    df["fund_known"] = has_fund

    # シナリオ（トリプルはX依存のため対象外）
    df["sig_scn_volume"] = df["volume_alert"]
    df["sig_scn_growth"] = bool(pd.notna(growth) and growth >= 30.0) & (df["volume"] >= 500000) & (df["score"] >= 65)
    df["sig_scn_steady"] = (df["score"] >= 65) & bool(profitable and pd.notna(vc) and vc <= 15.0)
    df["sig_scn_value"] = (df["close"] <= df["initial_adj"]) & (df["score"] >= 50) & bool(profitable)
    df["lockup_has_15x"] = bool(meta.get("lockup_has_15x")) if pd.notna(meta.get("lockup_has_15x")) else False

    # --- 先行リターン（翌日寄付エントリー基準） ---
    entry_open = df["open"].shift(-1)
    df["entry_open"] = entry_open
    for h in HORIZONS:
        exit_close = df["close"].shift(-1 - h)
        df[f"fwd{h}"] = exit_close / entry_open - 1.0
    return df


def simulate_tp_sl(g: pd.DataFrame, i: int, entry: float, tp: float, sl: float,
                   max_days: int = 60) -> tuple[float, str, int]:
    """i行目のシグナルに対し翌日寄付entryでTP/SL/タイムアウトを判定する。
    エントリー当日以降の高安でヒット判定。同日にTP/SL両方に触れた場合は
    保守的にSL扱いとする。"""
    for d in range(i + 1, min(i + 1 + max_days, len(g))):
        hi, lo = g["high"].iloc[d], g["low"].iloc[d]
        if lo <= sl:
            return sl / entry - 1.0, "SL" if hi < tp else "SL(同日TP併発)", d - i - 1
        if hi >= tp:
            return tp / entry - 1.0, "TP", d - i - 1
    last = min(i + max_days, len(g) - 1)
    return g["close"].iloc[last] / entry - 1.0, "時間切れ", last - i - 1


# シナリオ別のTP/SL算出式 (app.py 989-1086。price=シグナル日終値)
TPSL = {
    "sig_scn_volume": lambda r: (round(r["close"] * 1.15), round(r["recent_low"] * 0.97)),
    "sig_scn_growth": lambda r: (
        round(r["offer_adj"] * 1.5 * 0.97) if r["lockup_has_15x"] else round(r["close"] * 1.20),
        round(r["close"] * 0.90)),
    "sig_scn_steady": lambda r: (round(r["close"] * 1.15), round(r["close"] * 0.92)),
    "sig_scn_value": lambda r: (round(r["offer_adj"] * 0.98), round(r["close"] * 0.88)),
}


def extract_trades(panel: pd.DataFrame, sig_col: str, cooldown: int = 5) -> pd.DataFrame:
    """シグナル列からトレードを抽出する（ポジション保有中は再エントリーしない）。"""
    trades = []
    tpsl_fn = TPSL.get(sig_col)
    for code, g in panel.groupby("code"):
        g = g.reset_index(drop=True)
        next_ok = 0
        for i in range(len(g)):
            if not g[sig_col].iloc[i] or i < next_ok:
                continue
            entry = g["entry_open"].iloc[i]
            if np.isnan(entry):
                continue
            row = {
                "code": code, "signal_date": g["date"].iloc[i],
                "n_day": g["n_day"].iloc[i], "score": g["score"].iloc[i],
                "grade": g["grade"].iloc[i], "entry": entry,
            }
            for h in HORIZONS:
                row[f"fwd{h}"] = g[f"fwd{h}"].iloc[i]
            if tpsl_fn is not None:
                tp, sl = tpsl_fn(g.iloc[i])
                ret, outcome, days = simulate_tp_sl(g, i, entry, tp, sl)
                row.update({"tpsl_ret": ret, "tpsl_outcome": outcome, "tpsl_days": days})
            trades.append(row)
            next_ok = i + 20 + cooldown  # 20日保有+クールダウン相当
    return pd.DataFrame(trades)


def summarize(trades: pd.DataFrame, panel: pd.DataFrame, label: str) -> dict:
    """トレード集計＋同日ユニバース平均との超過リターン。"""
    if trades.empty:
        return {"rule": label, "n_trades": 0}
    uni20 = panel.groupby("date")["fwd20"].mean()
    out = {"rule": label, "n_trades": int(len(trades)),
           "n_stocks": int(trades["code"].nunique())}
    for h in HORIZONS:
        r = trades[f"fwd{h}"].dropna()
        if r.empty:
            continue
        out[f"win{h}"] = float((r > 0).mean())
        out[f"mean{h}"] = float(r.mean())
        out[f"median{h}"] = float(r.median())
    excess = (trades["fwd20"].values -
              uni20.reindex(trades["signal_date"]).values)
    excess = pd.Series(excess).dropna()
    if not excess.empty:
        out["excess20_mean"] = float(excess.mean())
        out["excess20_win"] = float((excess > 0).mean())
    if "tpsl_ret" in trades.columns:
        r = trades["tpsl_ret"].dropna()
        out["tpsl_mean"] = float(r.mean())
        out["tpsl_win"] = float((r > 0).mean())
        out["tpsl_outcomes"] = trades["tpsl_outcome"].value_counts().to_dict()
    return out


def main() -> None:
    ipos = pd.read_csv(BASE / "data" / "ipo_list.csv", dtype={"code": str})
    fund = pd.read_csv(BASE / "data" / "fundamentals.csv", dtype={"code": str})
    meta = ipos.merge(fund, on="code", how="left", suffixes=("", "_f"))
    if "lead_underwriter_f" in meta.columns:
        meta["lead_underwriter"] = meta["lead_underwriter"].fillna(meta["lead_underwriter_f"])

    nikkei = pd.read_csv(BASE / "data" / "nikkei.csv", index_col=0, parse_dates=True)["Close"]
    listing_dates = pd.to_datetime(ipos["listing_date"])
    env_pts = {}
    for t in nikkei.index:
        cnt = int(((listing_dates <= t) & (listing_dates > t - pd.Timedelta(days=30))).sum())
        env_pts[t] = rules.env_total_points(rules.market_env_at(nikkei.loc[:t], cnt))
    nikkei_pts = pd.Series(env_pts)

    panels = []
    for _, m in meta.iterrows():
        p = build_stock_panel(m["code"], m, nikkei_pts)
        if p is not None:
            panels.append(p)
    panel = pd.concat(panels, ignore_index=True)
    # ユニバース: 上場後2年以内のみ（アプリ既定フィルタ）
    panel = panel[panel["n_day"] <= 245 * UNIVERSE_YEARS]
    panel.to_csv(OUT / "panel.csv", index=False)
    print(f"パネル構築: {panel['code'].nunique()}銘柄 {len(panel)}行")

    summaries = []
    for sig, label in [
        ("sig_gold", "お宝ゴールド"), ("sig_solid", "堅実2倍株"),
        ("sig_scn_volume", "シナリオ:出来高急増底打ち"),
        ("sig_scn_growth", "シナリオ:成長企業型"),
        ("sig_scn_steady", "シナリオ:堅調企業型"),
        ("sig_scn_value", "シナリオ:割安銘柄型"),
    ]:
        tr = extract_trades(panel, sig)
        tr.to_csv(OUT / f"trades_{sig}.csv", index=False)
        summaries.append(summarize(tr, panel, label))

    # グレード別の先行リターン（銘柄×日の全観測、20日）
    grade_stats = (panel.dropna(subset=["fwd20"]).groupby("grade")["fwd20"]
                   .agg(["count", "mean", "median", lambda s: (s > 0).mean()]))
    grade_stats.columns = ["n", "mean20", "median20", "win20"]

    # スコアIC: 月末クロスセクションのSpearman相関
    panel["month"] = panel["date"].astype("datetime64[ns]").dt.to_period("M")
    ics = []
    for m, g in panel.groupby("month"):
        last = g[g["date"] == g["date"].max()].dropna(subset=["fwd20"])
        if len(last) >= 8:
            ic = last["score"].corr(last["fwd20"], method="spearman")
            if pd.notna(ic):
                ics.append({"month": str(m), "ic": float(ic), "n": len(last)})

    # Secondary Pickups トップ3: 月初にスコア上位3銘柄を20日保有
    picks = []
    for m, g in panel.groupby("month"):
        first_date = g["date"].min()
        snap = g[g["date"] == first_date].dropna(subset=["fwd20"])
        if len(snap) >= 5:
            top3 = snap.nlargest(3, "score")
            picks.append({"month": str(m), "top3_ret": float(top3["fwd20"].mean()),
                          "universe_ret": float(snap["fwd20"].mean()), "n_universe": len(snap)})
    picks_df = pd.DataFrame(picks)

    # ベースライン: 全IPOを上場2日目寄付で買い20/60日保有
    base_rows = panel[panel["n_day"] == 1].dropna(subset=["fwd20"])

    result = {
        "coverage": {
            "n_ipos_total": int(len(ipos)),
            "n_with_prices": int(panel["code"].nunique()),
            "n_with_fundamentals": int(panel[panel["fund_known"]]["code"].nunique()),
            "n_with_mcap": int(panel[panel["mcap_known"]]["code"].nunique()),
        },
        "rules": summaries,
        "grades_fwd20": grade_stats.reset_index().to_dict("records"),
        "score_ic": {"mean": float(np.mean([x["ic"] for x in ics])) if ics else None,
                     "positive_months": sum(1 for x in ics if x["ic"] > 0),
                     "n_months": len(ics), "monthly": ics},
        "top3_monthly": {"mean_top3": float(picks_df["top3_ret"].mean()) if not picks_df.empty else None,
                         "mean_universe": float(picks_df["universe_ret"].mean()) if not picks_df.empty else None,
                         "months_beat": int((picks_df["top3_ret"] > picks_df["universe_ret"]).sum()) if not picks_df.empty else 0,
                         "n_months": len(picks_df)},
        "baseline_all_ipo_day2": {
            "n": int(len(base_rows)),
            "mean20": float(base_rows["fwd20"].mean()),
            "win20": float((base_rows["fwd20"] > 0).mean()),
            "mean60": float(base_rows["fwd60"].dropna().mean()) if base_rows["fwd60"].notna().any() else None,
        },
    }
    (OUT / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    print(json.dumps(result["rules"], ensure_ascii=False, indent=2, default=str))
    print("→ data/out/summary.json に保存")


if __name__ == "__main__":
    main()
