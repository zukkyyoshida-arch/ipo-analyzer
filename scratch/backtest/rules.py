"""Apollo IPO v2.0 (Streamlit版 app.py) の推奨ルールをバックテスト用に忠実移植したモジュール。

移植元: GitHub zukkyyoshida-arch/ipo-analyzer main の app.py
  - calculate_rsi            (app.py 910-921)
  - calculate_notebooklm_scores (app.py 771-905)
  - evaluate_scenarios       (app.py 923-1088)
  - filter_gold_gems         (app.py 1090-1157)
  - filter_solid_double      (app.py 1159-1223)
  - auto_detect_market_env   (app.py 442-483)

デプロイ版（Streamlit Cloud）の実挙動に合わせた前提:
  - bb_ratio: JPX自動追加銘柄では常に0 → s_bb=1 の分岐に固定
  - X感情スコア: クラウド上ではスクレイピングがほぼ常に失敗し
    「前日比騰落率」による代替加点パスが走る → そのパスのみ再現
  - 市場環境: auto_detect_market_env と同じ式を ^N225 履歴から日次で復元
"""

from __future__ import annotations

import numpy as np
import pandas as pd

MAJOR_UNDERWRITERS = ("野村", "大和", "SMBC日興", "日興", "みずほ", "三菱UFJ")


def is_major_underwriter(name: str | None) -> bool:
    """app.py の underwriter=='大手' 判定の代替。

    元データはCSVに手書きされた「大手/その他」ラベルのため定義が不明。
    本検証では5大証券を「大手」とみなす（SBI等は「その他」）。感度分析対象。
    """
    if not name:
        return False
    return any(k in name for k in MAJOR_UNDERWRITERS)


def calculate_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """app.py 910-921 と同一（Wilder式ではなく単純移動平均ベース、NaNは50埋め）。"""
    if len(prices) < period:
        return pd.Series(50, index=prices.index)
    delta = prices.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


# ---------------------------------------------------------------------------
# 市場環境 (app.py 442-483 auto_detect_market_env の点時刻版)
# ---------------------------------------------------------------------------

def market_env_at(nikkei_close: pd.Series, ipo_count_30d: int) -> dict:
    """日付tまでの^N225終値系列と直近30日IPO件数から市場環境を判定する。"""
    env = {"nikkei_trend": "レンジ", "ipo_count": "少ない/適正", "sentiment": "中立"}
    hist = nikkei_close.tail(22)  # period="1mo" 相当
    if len(hist) >= 10:
        current = hist.iloc[-1]
        sma_recent = hist.rolling(window=10).mean().iloc[-1]
        roc_5d = (current - hist.iloc[-6]) / hist.iloc[-6] * 100 if len(hist) > 5 else 0
        if current > sma_recent * 1.01:
            env["nikkei_trend"] = "上昇"
        elif current < sma_recent * 0.99:
            env["nikkei_trend"] = "下落"
        if roc_5d > 1.5:
            env["sentiment"] = "強気"
        elif roc_5d < -1.5:
            env["sentiment"] = "弱気"
    if ipo_count_30d >= 5:
        env["ipo_count"] = "過密"
    return env


def env_total_points(env: dict) -> int:
    """app.py 781-792: 市場環境の得点（最大20点、全銘柄一律加算）。"""
    if env["nikkei_trend"] == "上昇":
        me_trend = 10
    elif env["nikkei_trend"] == "レンジ":
        me_trend = 6
    else:
        me_trend = 2
    me_count = 5 if env["ipo_count"] == "少ない/適正" else 2
    if env["sentiment"] == "強気":
        me_sent = 5
    elif env["sentiment"] == "中立":
        me_sent = 3
    else:
        me_sent = 1
    return me_trend + me_count + me_sent


# ---------------------------------------------------------------------------
# 総合スコア (app.py 771-905 calculate_notebooklm_scores の1銘柄・点時刻版)
# ---------------------------------------------------------------------------

def notebooklm_score(
    *,
    initial_price: float,
    offering_price: float,
    close: float,
    volume: float,
    day_pct_change: float,
    market_cap: float,          # 円
    sales_growth: float | None,  # % YoY (不明はNone→最低区分)
    vc_ratio: float | None,      # % (不明はNone→ペナルティ非該当)
    lockup_days: int | None,
    days_since_listing: int,
    underwriter_major: bool,
    env_points: int,
) -> dict:
    """デプロイ版実挙動の総合スコア。bb_ratio=0固定・X感情は代替加点パス。"""
    init_over_off = initial_price / offering_price if offering_price else 1.0
    if init_over_off <= 1.3:
        s_init = 15
    elif init_over_off <= 1.8:
        s_init = 10
    else:
        s_init = 5

    init_change = (close / initial_price - 1.0) * 100 if initial_price else 0.0
    if init_change <= -40.0:
        s_adjust = 15
    elif init_change <= -20.0:
        s_adjust = 12
    elif init_change <= 0.0:
        s_adjust = 9
    elif init_change <= 20.0:
        s_adjust = 6
    else:
        s_adjust = 3

    if volume >= 500000:
        s_vol = 10
    elif volume >= 200000:
        s_vol = 7
    else:
        s_vol = 4

    s_bb = 1  # bb_ratio=0（自動追加銘柄のデプロイ実挙動）
    supply_total = s_init + s_adjust + s_vol + s_bb

    mcap_oku = market_cap / 1e8
    if mcap_oku < 100.0:
        s_mcap = 8
    elif mcap_oku < 300.0:
        s_mcap = 5
    else:
        s_mcap = 2
    g = sales_growth if sales_growth is not None else -999
    if g >= 40.0:
        s_growth = 7
    elif g >= 20.0:
        s_growth = 5
    elif g >= 10.0:
        s_growth = 3
    else:
        s_growth = 1
    company_total = s_mcap + s_growth

    underwriter_total = 20 if underwriter_major else 10

    penalty = 0
    if lockup_days is not None and vc_ratio is not None:
        days_remaining = lockup_days - days_since_listing
        if 0 < days_remaining <= 90 and vc_ratio >= 15.0:
            penalty += -15
    if init_change <= -50.0 and volume < 200000:
        penalty += -10

    # X感情の代替加点パス (app.py 868-874)
    if day_pct_change >= 2.0:
        x_add = 5
    elif day_pct_change >= 0.0:
        x_add = 3
    else:
        x_add = 0

    raw = supply_total + env_points + company_total + underwriter_total + penalty + x_add
    total = max(0, min(100, raw))
    if total >= 80:
        grade = "S"
    elif total >= 65:
        grade = "A"
    elif total >= 50:
        grade = "B"
    elif total >= 35:
        grade = "C"
    else:
        grade = "D"
    return {
        "score": total,
        "grade": grade,
        "supply": supply_total,
        "market": env_points,
        "company": company_total,
        "underwriter": underwriter_total,
        "penalty": penalty,
        "x": x_add,
        "init_change_pct": init_change,
    }


# ---------------------------------------------------------------------------
# テクニカル条件 (app.py 932-954 / 1122-1141 / 1190-1208)
# ---------------------------------------------------------------------------

def technical_state(chart: pd.DataFrame) -> dict:
    """日付tまでのOHLCV (columns: Open High Low Close Volume) からアプリ共通の
    テクニカル状態を計算する。chartは上場日からtまでの全履歴。"""
    out = {"rsi": 50.0, "volume_alert": False, "above_ma25": False,
           "vol_growing": False, "recent_low": np.nan}
    n = len(chart)
    if n >= 2:
        out["vol_growing"] = bool(chart["Volume"].iloc[-1] > chart["Volume"].iloc[-2])
    if n >= 3:
        ma_window = min(25, n)
        ma_val = chart["Close"].rolling(window=ma_window).mean().iloc[-1]
        out["above_ma25"] = bool(chart["Close"].iloc[-1] > ma_val)
    if n >= 6:
        closes = chart["Close"]
        rsi_series = calculate_rsi(closes)
        out["rsi"] = float(rsi_series.iloc[-1])
        current_vol = chart["Volume"].iloc[-1]
        prev_5d_vol_avg = chart["Volume"].iloc[-6:-1].mean()
        is_price_up = chart["Close"].iloc[-1] > chart["Close"].iloc[-2]
        out["recent_low"] = float(chart["Low"].iloc[-10:].min())
        if prev_5d_vol_avg > 0 and current_vol >= prev_5d_vol_avg * 2.0 \
                and is_price_up and out["rsi"] <= 38.0:
            out["volume_alert"] = True
    return out


# ---------------------------------------------------------------------------
# お宝ゴールド (app.py 1090-1157)
# ---------------------------------------------------------------------------

def gold_gem_signal(
    *, vc_ratio, sales_growth, is_profitable, market_cap,
    close, offering_price, tech: dict,
) -> list[str]:
    """条件を満たす場合は理由リスト、満たさない場合は空リストを返す。"""
    if vc_ratio is None or sales_growth is None or is_profitable is None:
        return []
    if vc_ratio > 15.0 or sales_growth < 20.0 or not is_profitable \
            or market_cap > 150e8:
        return []
    reasons = []
    if close < offering_price:
        reasons.append("公募価格割れ")
    if tech["volume_alert"] or tech["rsi"] <= 38.0:
        reasons.append("RSI底打ち")
    return reasons


# ---------------------------------------------------------------------------
# 堅実2倍株 (app.py 1159-1223)
# ---------------------------------------------------------------------------

def solid_double_signal(
    *, vc_ratio, sales_growth, is_profitable, market_cap, tech: dict,
) -> list[str]:
    if vc_ratio is None or sales_growth is None or is_profitable is None:
        return []
    if vc_ratio > 20.0 or sales_growth < 35.0 or not is_profitable \
            or not (100e8 <= market_cap <= 500e8):
        return []
    reasons = []
    if tech["above_ma25"]:
        reasons.append("MA25突破")
    if tech["vol_growing"]:
        reasons.append("出来高増")
    return reasons


# ---------------------------------------------------------------------------
# 取引シナリオ (app.py 923-1088 evaluate_scenarios)
# X感情はクラウドで常に失敗（pos_pct=乱数）のためトリプルシグナルは検証対象外とし、
# 残り4シナリオのentry/tp/slを忠実に再現する。
# ---------------------------------------------------------------------------

def scenarios_at(
    *, close, initial_price, offering_price, sales_growth, volume,
    score, is_profitable, vc_ratio, lockup_has_15x: bool | None, tech: dict,
) -> list[dict]:
    out = []
    price = close
    recent_low = tech["recent_low"] if not np.isnan(tech["recent_low"]) else price * 0.95

    if tech["volume_alert"]:
        out.append({
            "name": "出来高急増・底打ち反発",
            "entry": np.round(price * 0.97, 0),
            "tp": np.round(price * 1.15, 0),
            "sl": np.round(recent_low * 0.97, 0),
        })

    if (sales_growth is not None and sales_growth >= 30.0
            and volume >= 500000 and score >= 65):
        if lockup_has_15x:
            tp = np.round((offering_price * 1.5) * 0.97, 0)
        else:
            tp = np.round(price * 1.20, 0)
        out.append({
            "name": "成長企業型",
            "entry": np.round(price * 0.99, 0),
            "tp": tp,
            "sl": np.round(price * 0.90, 0),
        })

    if score >= 65 and is_profitable and vc_ratio is not None and vc_ratio <= 15.0:
        out.append({
            "name": "堅調企業型",
            "entry": np.round(price * 0.98, 0),
            "tp": np.round(price * 1.15, 0),
            "sl": np.round(price * 0.92, 0),
        })

    init_change = (close / initial_price - 1.0) * 100 if initial_price else 0.0
    if init_change <= 0.0 and score >= 50 and is_profitable:
        out.append({
            "name": "割安銘柄型",
            "entry": np.round(price * 0.96, 0),
            "tp": np.round(offering_price * 0.98, 0),
            "sl": np.round(price * 0.88, 0),
        })
    return out
