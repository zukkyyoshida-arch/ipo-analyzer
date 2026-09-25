"""IPO銘柄の日足OHLCVをyfinanceで取得して data/prices/{code}.csv に保存する。

入力: data/ipo_list.csv (columns: code,name,listing_date,offer_price,first_price,...)
出力: data/prices/{code}.csv, data/nikkei.csv, data/fetch_log.csv

- 株式分割があった銘柄は 'split_factor' 列に累積分割係数を持たせる
  （公募価格・初値との比較時に価格系列を上場時スケールへ換算するため）。
- yfinance初値(上場日Open)と収集した初値の3%超乖離は fetch_log に警告として残す。
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

BASE = Path(__file__).parent
PRICES = BASE / "data" / "prices"
PRICES.mkdir(parents=True, exist_ok=True)


def fetch_one(code: str, listing_date: str) -> pd.DataFrame | None:
    ticker = yf.Ticker(f"{code}.T")
    hist = ticker.history(start=listing_date, auto_adjust=False, actions=True)
    if hist is None or hist.empty:
        return None
    hist = hist.tz_localize(None)
    splits = hist.get("Stock Splits")
    if splits is not None:
        factor = splits.replace(0, 1.0).cumprod()
    else:
        factor = pd.Series(1.0, index=hist.index)
    out = hist[["Open", "High", "Low", "Close", "Volume"]].copy()
    out["split_factor"] = factor
    return out


def main() -> None:
    ipos = pd.read_csv(BASE / "data" / "ipo_list.csv", dtype={"code": str})
    log_rows = []
    for i, row in ipos.iterrows():
        code = row["code"].strip()
        path = PRICES / f"{code}.csv"
        if path.exists():
            continue
        try:
            df = fetch_one(code, row["listing_date"])
        except Exception as e:  # noqa: BLE001
            log_rows.append({"code": code, "status": "error", "detail": str(e)[:200]})
            time.sleep(1.0)
            continue
        if df is None or df.empty:
            log_rows.append({"code": code, "status": "empty", "detail": ""})
            time.sleep(0.4)
            continue
        df.to_csv(path)
        detail = ""
        fp = row.get("first_price")
        if pd.notna(fp) and fp:
            yf_first_open = df["Open"].iloc[0]
            if yf_first_open > 0 and abs(yf_first_open / fp - 1) > 0.03:
                detail = f"初値乖離: 収集値{fp} vs yfinance{yf_first_open:.0f}"
        n_splits = int((df["split_factor"].diff().fillna(0) != 0).sum())
        log_rows.append({
            "code": code, "status": "ok",
            "detail": detail or (f"分割{n_splits}回" if n_splits else ""),
        })
        if i % 20 == 0:
            print(f"{i + 1}/{len(ipos)} done", flush=True)
        time.sleep(0.4)

    nikkei = yf.Ticker("^N225").history(start="2023-10-01", auto_adjust=False)
    nikkei.tz_localize(None)[["Close"]].to_csv(BASE / "data" / "nikkei.csv")

    pd.DataFrame(log_rows).to_csv(BASE / "data" / "fetch_log.csv", index=False)
    ok = sum(1 for r in log_rows if r["status"] == "ok")
    print(f"完了: {ok}/{len(log_rows)}銘柄取得, 警告={sum(1 for r in log_rows if r['detail'])}")


if __name__ == "__main__":
    sys.exit(main())
