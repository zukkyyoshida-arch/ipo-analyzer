"""ファンダ収集ワークフローの出力をfundamentals.csvへ整形する。

使い方: venv/bin/python merge_fundamentals.py <workflow_output_json>
"""

import json
import sys
from pathlib import Path

import pandas as pd

BASE = Path(__file__).parent


def main(path: str) -> None:
    doc = json.load(open(path))
    result = doc["result"] if "result" in doc else doc
    stocks = result["stocks"]
    df = pd.DataFrame(stocks)
    df["code"] = df["code"].astype(str).str.strip()
    df = df.drop_duplicates(subset="code", keep="first")

    ipos = pd.read_csv(BASE / "data" / "ipo_list.csv", dtype={"code": str})
    missing = set(ipos["code"]) - set(df["code"])

    for col in ["vc_ratio", "sales_growth", "mcap_offer_oku", "absorption_oku", "lockup_days"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    cov = {c: int(df[c].notna().sum()) for c in
           ["vc_ratio", "sales_growth", "is_profitable", "lockup_days",
            "lockup_has_15x", "mcap_offer_oku", "absorption_oku"]}
    print(f"収集: {len(df)}銘柄 / リスト{len(ipos)}銘柄, 未収集: {sorted(missing)}")
    print("項目別カバレッジ:", cov)

    # 明らかな異常値チェック
    bad_vc = df[(df["vc_ratio"] < 0) | (df["vc_ratio"] > 100)]
    bad_mcap = df[(df["mcap_offer_oku"] <= 0) | (df["mcap_offer_oku"] > 100000)]
    if not bad_vc.empty:
        print("VC比率異常:", bad_vc[["code", "vc_ratio"]].to_dict("records"))
    if not bad_mcap.empty:
        print("時価総額異常:", bad_mcap[["code", "mcap_offer_oku"]].to_dict("records"))

    df.to_csv(BASE / "data" / "fundamentals.csv", index=False)
    print("→ data/fundamentals.csv 保存")
    if result.get("notes"):
        print("--- 収集ノート ---")
        for n in result["notes"][:20]:
            print(" *", str(n)[:200])


if __name__ == "__main__":
    main(sys.argv[1])
