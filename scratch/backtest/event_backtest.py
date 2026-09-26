"""セカンダリーのイベント前後リターン検証（Phase 3）。

イベント種別:
  lockupExpiry    ロックアップ解除日 = 上場日 + lockup_days（暦日）以降の最初の営業日
  priceRelease15x 1.5倍解除到達日 = 終値(上場時スケール)が公開価格×1.5 を初めて上回った日
                  （lockup_has_15x の銘柄のみ）
  firstEarnings   上場後最初の決算発表日（ipos.auto/base.json の firstEarningsDate があるもののみ）

各イベント日 T（営業日インデックス t）について、終値を分割補正（Close × split_factor）した系列で
  before20 = P[t] / P[t-20] - 1
  after5   = P[t+5] / P[t] - 1
  after20  = P[t+20] / P[t] - 1
を計算する。窓が足りないものはその指標だけ欠損にする。
ベンチマーク = 同じ暦日区間 [date(t), date(t+k)] の「他の全IPO（上場から20営業日経過済み）」の
等加重平均リターン。超過 = 個別 − ベンチマーク。

入力: data/ipo_list.csv, data/fundamentals.csv, data/prices/*.csv,
      ../../public/data/ipos.{base,auto,enriched}.json
出力: data/out/event_samples.csv, data/out/event_summary.json,
      ../../public/data/event-stats.json（アプリ用の小さい集計のみ）
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).parent
ROOT = BASE.parent.parent
PRICES = BASE / "data" / "prices"
OUT = BASE / "data" / "out"
PUBLIC = ROOT / "public" / "data"

EVENT_KINDS = ("lockupExpiry", "priceRelease15x", "firstEarnings")
BENCH_MIN_AGE = 20  # ベンチマークに入れる銘柄は上場から20営業日経過済み


def load_prices() -> dict[str, pd.Series]:
    out: dict[str, pd.Series] = {}
    for p in sorted(PRICES.glob("*.csv")):
        df = pd.read_csv(p, parse_dates=["Date"]).dropna(subset=["Close"])
        if df.empty:
            continue
        sf = df["split_factor"].fillna(1.0) if "split_factor" in df else 1.0
        s = pd.Series((df["Close"] * sf).values, index=df["Date"].dt.normalize())
        out[p.stem] = s[~s.index.duplicated(keep="last")].sort_index()
    return out


def load_meta() -> pd.DataFrame:
    ipos = pd.read_csv(BASE / "data" / "ipo_list.csv", dtype={"code": str})
    ipos["code"] = ipos["code"].str.strip()
    ipos = ipos.drop_duplicates("code", keep="first").set_index("code")
    fund = pd.read_csv(BASE / "data" / "fundamentals.csv", dtype={"code": str})
    fund = fund.drop_duplicates("code").set_index("code")
    ipos["lockup_days"] = fund["lockup_days"]
    ipos["lockup_has_15x"] = fund["lockup_has_15x"]

    # enriched.json のロックアップで欠損を補完、公開価格も補完
    enriched = {x["code"]: x for x in json.loads((PUBLIC / "ipos.enriched.json").read_text())}
    apps: dict[str, dict] = {}
    for name in ("ipos.base.json", "ipos.auto.json"):
        for x in json.loads((PUBLIC / name).read_text()):
            apps.setdefault(x["code"], {}).update({k: v for k, v in x.items() if v is not None})
    for code in ipos.index:
        e = enriched.get(code, {})
        a = apps.get(code, {})
        lk = e.get("lockup") or a.get("lockup")
        if pd.isna(ipos.at[code, "lockup_days"]) and lk and lk.get("days"):
            ipos.at[code, "lockup_days"] = lk["days"]
        if pd.isna(ipos.at[code, "lockup_has_15x"]) and lk is not None:
            ipos.at[code, "lockup_has_15x"] = bool(lk.get("hasPriceRelease"))
        if pd.isna(ipos.at[code, "offer_price"]):
            ipos.at[code, "offer_price"] = a.get("offeringPrice") or e.get("offeringPrice")
    ipos["first_earnings"] = [apps.get(c, {}).get("firstEarningsDate") for c in ipos.index]
    ipos["lockup_has_15x"] = ipos["lockup_has_15x"].map(
        lambda v: str(v).lower() == "true" if pd.notna(v) else False)
    return ipos


def first_index_on_or_after(s: pd.Series, d: pd.Timestamp) -> int | None:
    pos = int(s.index.searchsorted(d))
    return pos if pos < len(s) else None


def build_events(meta: pd.DataFrame, prices: dict[str, pd.Series]) -> list[dict]:
    events = []
    for code, row in meta.iterrows():
        s = prices.get(code)
        if s is None or len(s) < 2:
            continue
        listing = pd.Timestamp(row["listing_date"])
        # (a) ロックアップ解除
        if pd.notna(row["lockup_days"]) and row["lockup_days"] > 0:
            d = listing + timedelta(days=int(row["lockup_days"]))
            if d <= s.index[-1]:
                t = first_index_on_or_after(s, d)
                if t is not None:
                    events.append({"code": code, "kind": "lockupExpiry", "t": t,
                                   "lockup_days": int(row["lockup_days"])})
        # (b) 1.5倍解除到達
        offer = row["offer_price"]
        if row["lockup_has_15x"] and pd.notna(offer) and offer > 0:
            hit = np.flatnonzero(s.values > offer * 1.5)
            if len(hit):
                events.append({"code": code, "kind": "priceRelease15x", "t": int(hit[0]),
                               "lockup_days": row["lockup_days"]})
        # (c) 初回決算
        fe = row["first_earnings"]
        if fe:
            d = pd.Timestamp(fe)
            if listing < d <= s.index[-1]:
                t = first_index_on_or_after(s, d)
                if t is not None:
                    events.append({"code": code, "kind": "firstEarnings", "t": t,
                                   "lockup_days": row["lockup_days"]})
    return events


def window_return(s: pd.Series, t0: int, t1: int) -> float:
    if t0 < 0 or t1 >= len(s) or t0 == t1:
        return np.nan
    a, b = s.iat[t0], s.iat[t1]
    return float(b / a - 1) if a > 0 else np.nan


def bench_return(prices: dict[str, pd.Series], exclude: str,
                 d0: pd.Timestamp, d1: pd.Timestamp) -> float:
    rets = []
    for code, s in prices.items():
        if code == exclude:
            continue
        i0 = int(s.index.searchsorted(d0))
        if i0 >= len(s) or s.index[i0] != d0 or i0 < BENCH_MIN_AGE:
            continue
        i1 = int(s.index.searchsorted(d1))
        if i1 >= len(s) or s.index[i1] != d1:
            continue
        rets.append(s.iat[i1] / s.iat[i0] - 1)
    return float(np.mean(rets)) if rets else np.nan


def compute_samples(events: list[dict], prices: dict[str, pd.Series]) -> pd.DataFrame:
    rows = []
    for ev in events:
        s = prices[ev["code"]]
        t = ev["t"]
        r = {**ev, "date": s.index[t].date().isoformat(), "year": s.index[t].year,
             "days_from_listing": t}
        for name, t0, t1 in (("before20", t - 20, t), ("after5", t, t + 5), ("after20", t, t + 20)):
            r[name] = window_return(s, t0, t1)
            if np.isnan(r[name]):
                r[f"{name}_bench"] = np.nan
            else:
                r[f"{name}_bench"] = bench_return(prices, ev["code"], s.index[t0], s.index[t1])
            r[f"{name}_excess"] = r[name] - r[f"{name}_bench"]
        rows.append(r)
    return pd.DataFrame(rows)


def pct(v: float) -> float | None:
    return None if v is None or np.isnan(v) else round(float(v) * 100, 2)


def summarize(df: pd.DataFrame) -> dict:
    def stats(col: str) -> dict:
        x = df[col].dropna()
        return {"n": int(len(x)), "mean": pct(x.mean()) if len(x) else None,
                "median": pct(x.median()) if len(x) else None,
                "winRate": pct((x > 0).mean()) if len(x) else None}
    out = {c: stats(c) for c in ("before20", "after5", "after20",
                                 "before20_excess", "after5_excess", "after20_excess")}
    out["byYear"] = {}
    for y, g in df.groupby("year"):
        x = g["after20"].dropna()
        out["byYear"][str(y)] = {"n": int(len(x)), "meanAfter20": pct(x.mean()) if len(x) else None,
                                 "medianAfter20": pct(x.median()) if len(x) else None,
                                 "winRateAfter20": pct((x > 0).mean()) if len(x) else None}
    return out


def app_stats(df: pd.DataFrame) -> dict:
    a20 = df["after20"].dropna()
    years = []
    for y, g in df.groupby("year"):
        x = g["after20"].dropna()
        if len(x):
            years.append({"year": int(y), "sampleCount": int(len(x)),
                          "medianAfter20": pct(x.median())})
    return {
        "sampleCount": int(len(a20)),
        "meanBefore20": pct(df["before20"].mean()) if df["before20"].notna().any() else None,
        "meanAfter5": pct(df["after5"].mean()) if df["after5"].notna().any() else None,
        "meanAfter20": pct(a20.mean()) if len(a20) else None,
        "medianAfter20": pct(a20.median()) if len(a20) else None,
        "winRateAfter20": pct((a20 > 0).mean()) if len(a20) else None,
        "years": years,
    }


def main() -> None:
    prices = load_prices()
    meta = load_meta()
    events = build_events(meta, prices)
    df = compute_samples(events, prices)
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / "event_samples.csv", index=False)

    last_date = max(s.index[-1] for s in prices.values()).date().isoformat()
    summary: dict = {"asOf": last_date, "priceCodes": len(prices), "metaCodes": int(len(meta)),
                     "kinds": {}}
    app: dict = {"asOf": last_date, "kinds": {}}
    for kind in EVENT_KINDS:
        g = df[df["kind"] == kind] if len(df) else df
        summary["kinds"][kind] = {"events": int(len(g)), **(summarize(g) if len(g) else {})}
        app["kinds"][kind] = app_stats(g) if len(g) else {
            "sampleCount": 0, "meanBefore20": None, "meanAfter5": None, "meanAfter20": None,
            "medianAfter20": None, "winRateAfter20": None, "years": []}
    # ロックアップ日数別（レポート用）
    lk = df[df["kind"] == "lockupExpiry"]
    summary["lockupByDays"] = {str(int(d)): summarize(g) for d, g in lk.groupby("lockup_days")}
    # 1.5倍到達までの営業日数（上場直後の到達が多いと before20 が欠損する）
    r15 = df[df["kind"] == "priceRelease15x"]
    if len(r15):
        summary["priceRelease15xDaysFromListing"] = {
            "median": float(r15["days_from_listing"].median()),
            "within5": int((r15["days_from_listing"] <= 5).sum()),
            "total": int(len(r15))}
    (OUT / "event_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (PUBLIC / "event-stats.json").write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
