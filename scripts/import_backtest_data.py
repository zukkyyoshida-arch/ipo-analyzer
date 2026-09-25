#!/usr/bin/env python3
"""scratch/backtest/data/{ipo_list,fundamentals}.csv を public/data/ipos.base.json へ変換する。

- 標準ライブラリのみ使用。冪等（何度実行しても同じ結果になる）。
- 既存 base の実在銘柄で CSV に無いものは残す。601A〜604A（架空銘柄）は base から除く。
- CSV 側の market が「グロース/スタンダード/プライム」以外（東証を除く名証・札証・福証・
  複合区分等）の行は除外し、除外理由を excludedRows に記録する（このスクリプト実行時に stderr へ出力）。
- 詳細な変換規則は scratch/mobile-design.md §5 を参照。

実行: python3 scripts/import_backtest_data.py
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
IPO_LIST_CSV = ROOT / "scratch/backtest/data/ipo_list.csv"
FUNDAMENTALS_CSV = ROOT / "scratch/backtest/data/fundamentals.csv"
BASE_JSON = ROOT / "public/data/ipos.base.json"

# 架空銘柄（Streamlit版のサンプルデータ由来）。base から除く。
FICTIONAL_CODES = {"601A", "602A", "603A", "604A"}

# market 正規化: 東証プレフィックスを剥がす。それ以外（名証・札証・福証・複合区分等）は除外。
MARKET_MAP = {
    "グロース": "グロース",
    "東証グロース": "グロース",
    "スタンダード": "スタンダード",
    "東証スタンダード": "スタンダード",
    "プライム": "プライム",
    "東証プライム": "プライム",
}

# theme-tagging.ts の THEME_KEYWORDS を最小限そのまま写した辞書（社名照合用）。
# 設計書 §5: 「社名に含まれる語での付与」の最小ルールとして採用（notes に明記）。
THEME_KEYWORDS: dict[str, list[str]] = {
    "AI": ["ai", "人工知能", "機械学習", "ディープラーニング", "深層学習", "生成ai", "llm", "推論"],
    "半導体": ["半導体", "semiconductor", "チップ", "wafer", "ウェハ", "集積回路"],
    "セキュリティ": ["セキュリティ", "security", "ゼロトラスト", "サイバー", "cyber", "暗号", "認証基盤", "soc"],
    "SaaS": ["saas", "サブスク", "subscription", "クラウドサービス", "業務システム", "プラットフォーム", "dx"],
    # "ec" は英字2文字のためローマ字社名（Synspective/GVA TECH/ZenmuTech 等）に
    # 偶然含まれて誤爆するため除外（data-pipeline-4 対応）。
    "D2C": ["d2c", "eコマース", "通販", "ブランド", "リカバリーウェア"],
    "人材": ["人材", "採用", "求人", "hr", "フリーランス", "副業", "マッチング", "業務委託"],
    "インフラ": ["インフラ", "電力", "エネルギー", "再エネ", "再生可能エネルギー", "通信網", "物流", "電気", "ガス"],
}


def infer_themes_from_name(name: str) -> list[str]:
    hay = name.lower()
    found: list[str] = []
    for tag, keywords in THEME_KEYWORDS.items():
        if any(kw.lower() in hay for kw in keywords):
            found.append(tag)
    return found


def to_float_or_none(value: str | None) -> float | None:
    if value is None:
        return None
    v = value.strip()
    if v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_bool(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in ("true", "1", "yes")


def load_ipo_list() -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    rows: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    with IPO_LIST_CSV.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            market_raw = (r.get("market") or "").strip()
            market = MARKET_MAP.get(market_raw)
            if market is None:
                excluded.append(
                    {
                        "code": r.get("code", ""),
                        "name": r.get("name", ""),
                        "market": market_raw,
                        "reason": "market not in グロース/スタンダード/プライム(東証含む)",
                    }
                )
                continue
            rows.append({**r, "market": market})
    return rows, excluded


def load_fundamentals() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    with FUNDAMENTALS_CSV.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["code"]] = r
    return out


def count_same_day_week(rows: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int]]:
    """同一 CSV 内の listing_date から同日/同週上場社数を実際に数える。"""
    from collections import Counter
    from datetime import date, timedelta

    def iso_week_key(d: date) -> tuple[int, int]:
        y, w, _ = d.isocalendar()
        return (y, w)

    day_counter: Counter[str] = Counter()
    week_counter: Counter[tuple[int, int]] = Counter()
    parsed: dict[str, date] = {}

    for r in rows:
        ld = (r.get("listing_date") or "").strip()
        if not ld:
            continue
        try:
            y, m, d = ld.split("-")
            dt = date(int(y), int(m), int(d))
        except ValueError:
            continue
        parsed[r["code"]] = dt
        day_counter[ld] += 1
        week_counter[iso_week_key(dt)] += 1

    same_day: dict[str, int] = {}
    same_week: dict[str, int] = {}
    for r in rows:
        code = r["code"]
        dt = parsed.get(code)
        if dt is None:
            same_day[code] = 1
            same_week[code] = 1
            continue
        ld = (r.get("listing_date") or "").strip()
        same_day[code] = day_counter[ld]
        same_week[code] = week_counter[iso_week_key(dt)]

    # 未使用の import 警告回避（timedelta は将来の週境界調整用に残す）
    _ = timedelta
    return same_day, same_week


def build_ipo(
    row: dict[str, Any],
    fund: dict[str, Any] | None,
    same_day: int,
    same_week: int,
    existing: dict[str, Any] | None = None,
    conflicts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    code = row["code"]
    name = row["name"]
    market = row["market"]
    listing_date = (row.get("listing_date") or "").strip()
    offer_price = to_float_or_none(row.get("offer_price"))
    first_price = to_float_or_none(row.get("first_price"))
    lead_underwriter = (row.get("lead_underwriter") or "").strip()

    absorption = None
    if fund is not None:
        absorption = to_float_or_none(fund.get("absorption_oku"))
    if absorption is None:
        absorption = to_float_or_none(row.get("absorption_oku"))
    if absorption is None:
        absorption = 0.0

    vc_ratio = to_float_or_none(fund.get("vc_ratio")) if fund else None
    sales_growth = to_float_or_none(fund.get("sales_growth")) if fund else None
    is_profitable = to_bool(fund.get("is_profitable")) if fund else False
    lockup_days = to_float_or_none(fund.get("lockup_days")) if fund else None
    lockup_has_15x = to_bool(fund.get("lockup_has_15x")) if fund else False
    mcap_offer = to_float_or_none(fund.get("mcap_offer_oku")) if fund else None

    offer_price_int = int(offer_price) if offer_price is not None else 0
    offering_price_new = int(offer_price) if offer_price is not None else None
    initial_price_new = int(first_price) if first_price is not None else None

    # 既存 base（手動管理）に同一コードがあれば、CSVには存在しない手動フィールド
    # （description/theme/bbPeriod 等）を維持する。CSV由来の数値項目は CSV/fundamentals を優先する。
    # （data-pipeline-3 対応: CSV優先の単純置換で手動情報が消えていたため）
    description = ""
    theme = infer_themes_from_name(name)
    bb_period = {"start": "", "end": ""}
    allotment_date = ""
    purchase_period = {"start": "", "end": ""}
    sector = ""
    similar_ipo_codes: list[str] = []

    if existing is not None:
        if existing.get("description"):
            description = existing["description"]
        existing_theme = existing.get("theme") or []
        if existing_theme:
            theme = existing_theme
        existing_bb = existing.get("bbPeriod") or {}
        if existing_bb.get("start") or existing_bb.get("end"):
            bb_period = {"start": existing_bb.get("start", ""), "end": existing_bb.get("end", "")}
        if existing.get("allotmentDate"):
            allotment_date = existing["allotmentDate"]
        existing_purchase = existing.get("purchasePeriod") or {}
        if existing_purchase.get("start") or existing_purchase.get("end"):
            purchase_period = {
                "start": existing_purchase.get("start", ""),
                "end": existing_purchase.get("end", ""),
            }
        if existing.get("sector"):
            sector = existing["sector"]
        if existing.get("similarIpoCodes"):
            similar_ipo_codes = existing["similarIpoCodes"]

        # 既存値とCSV値が食い違う数値項目はサイレントに上書きせず、ログ用に記録する。
        if conflicts is not None:
            existing_offer = existing.get("offeringPrice")
            if existing_offer is not None and offering_price_new is not None and existing_offer != offering_price_new:
                conflicts.append(
                    {
                        "code": code,
                        "field": "offeringPrice",
                        "old": existing_offer,
                        "new": offering_price_new,
                    }
                )
            existing_initial = existing.get("initialPrice")
            if existing_initial is not None and initial_price_new is not None and existing_initial != initial_price_new:
                conflicts.append(
                    {
                        "code": code,
                        "field": "initialPrice",
                        "old": existing_initial,
                        "new": initial_price_new,
                    }
                )

    ipo: dict[str, Any] = {
        "code": code,
        "name": name,
        "market": market,
        "sector": sector,
        "theme": theme,
        "description": description,
        "listingDate": listing_date,
        "bbPeriod": bb_period,
        "allotmentDate": allotment_date,
        "purchasePeriod": purchase_period,
        "assumedPrice": offer_price_int,
        "priceRange": {"low": offer_price_int, "high": offer_price_int},
        "offeringPrice": offering_price_new,
        "priceRangePosition": None,
        "publicShares": 0,
        "saleShares": 0,
        "overAllotment": 0,
        "absorptionAmount": absorption,
        "offeringRatio": 0,
        "marketCap": mcap_offer if mcap_offer is not None else 0,
        "vcRatio": vc_ratio if vc_ratio is not None else 0,
        "lockup": {
            "days": int(lockup_days) if lockup_days is not None else 0,
            "hasPriceRelease": lockup_has_15x,
            "coverage": 0,
        },
        "leadUnderwriter": lead_underwriter,
        "underwriters": [lead_underwriter] if lead_underwriter else [],
        "financials": {
            "revenue": 0,
            "revenueGrowth": sales_growth if sales_growth is not None else 0,
            "operatingProfit": 0,
            "isProfitable": is_profitable,
        },
        "per": None,
        "psr": None,
        "sameDayListings": same_day,
        "sameWeekListings": same_week,
        "initialPrice": initial_price_new,
        "status": "listed",
        "similarIpoCodes": similar_ipo_codes,
    }
    return ipo


def main() -> None:
    ipo_rows, excluded = load_ipo_list()
    fundamentals = load_fundamentals()
    same_day_map, same_week_map = count_same_day_week(ipo_rows)

    csv_codes = {r["code"] for r in ipo_rows}

    existing_base: list[dict[str, Any]] = []
    if BASE_JSON.exists():
        with BASE_JSON.open(encoding="utf-8") as f:
            existing_base = json.load(f)

    # 既存 base のうち「架空銘柄」を除き、「CSVに存在するコード」も除く（CSV優先で置き換えるため）。
    kept_existing = [
        b for b in existing_base if b["code"] not in FICTIONAL_CODES and b["code"] not in csv_codes
    ]
    existing_by_code = {b["code"]: b for b in existing_base}

    conflicts: list[dict[str, Any]] = []
    converted: list[dict[str, Any]] = []
    for row in ipo_rows:
        code = row["code"]
        fund = fundamentals.get(code)
        ipo = build_ipo(
            row,
            fund,
            same_day_map[code],
            same_week_map[code],
            existing=existing_by_code.get(code),
            conflicts=conflicts,
        )
        converted.append(ipo)

    result = kept_existing + converted

    BASE_JSON.parent.mkdir(parents=True, exist_ok=True)
    with BASE_JSON.open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[import_backtest_data] wrote {len(result)} records to {BASE_JSON}", file=sys.stderr)
    print(f"[import_backtest_data] kept existing (non-fictional, not in CSV): {len(kept_existing)}", file=sys.stderr)
    print(f"[import_backtest_data] converted from CSV: {len(converted)}", file=sys.stderr)
    print(f"[import_backtest_data] excluded rows (non グロース/スタンダード/プライム市場): {len(excluded)}", file=sys.stderr)
    for e in excluded:
        print(f"  - {e['code']} {e['name']} market={e['market']}", file=sys.stderr)

    if conflicts:
        print(
            f"[import_backtest_data] 既存値とCSV値が食い違うコード（CSV優先で上書き・要確認）: {len(conflicts)}件",
            file=sys.stderr,
        )
        for c in conflicts:
            print(f"  - {c['code']} {c['field']}: {c['old']} -> {c['new']}", file=sys.stderr)


if __name__ == "__main__":
    main()
