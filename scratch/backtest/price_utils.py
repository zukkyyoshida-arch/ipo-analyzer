"""価格CSV（data/prices/{code}.csv）の共通読み込みヘルパ。

前提（fetch_prices.py が yfinance から取得したもの）:
  - Open/High/Low/Close は取得時点ですでに「全期間が現在の分割スケールに調整済み」の連続した系列。
    株式分割日をまたいでも価格は飛ばない。
  - split_factor 列は「上場日からの累積分割係数」（分割前 1.0、分割後に 2.0 など）。
    これは価格に掛けるためのものではなく、公開価格・初値（上場時の単位）と比べるときの換算用。

使い方:
  - リターン計算 … 調整済みの Close をそのまま使う（split_factor を掛けない）。
  - 公開価格・初値と比べる … 公開価格 ÷ total_split_factor（= 現在スケールの公開価格）と
    調整済み Close を比べる。または Close × total_split_factor と上場時単位の公開価格を比べる。
    どちらも銘柄ごとに一定の係数なので、日ごとの split_factor を使ってはいけない。
"""

from __future__ import annotations

import pandas as pd

# 異常プレースホルダ行の判定: 終値が銘柄の中央値の何倍/何分の一を超えたら除外するか
OUTLIER_RATIO = 50


def clean_price_frame(df: pd.DataFrame) -> pd.DataFrame:
    """終値が欠損・0以下の行と、Yahooの異常プレースホルダ行を除く。

    プレースホルダ例: 8303 の上場日に O/H/L/C=553億円・出来高0 の行が入っている。
    銘柄内の終値の中央値の 50 倍超／50 分の 1 未満を異常とみなす。
    """
    df = df[df["Close"].notna() & (df["Close"] > 0)].copy()
    med = df["Close"].median()
    bad = (df["Close"] > med * OUTLIER_RATIO) | (df["Close"] < med / OUTLIER_RATIO)
    return df[~bad]


def total_split_factor(df: pd.DataFrame) -> float:
    """銘柄の総分割係数（split_factor の最終値。分割なしなら 1.0）。"""
    if "split_factor" not in df:
        return 1.0
    return float(df["split_factor"].ffill().fillna(1.0).iloc[-1])
