import type { Ipo } from "@/types/ipo";
import type { HistoricalIpo } from "@/types/history";
import type { OutcomeSource } from "./index";

// Ipo（2024〜）と HistoricalIpo（2015〜2023）を統計用の共通形 OutcomeSource へ揃える純関数。
// 全銘柄の詳細項目をクライアントへ渡さないよう、集計に必要な項目だけを残す。

/** Ipo → OutcomeSource。吸収金額・OR の 0 以下は未取得（null）に読み替える。 */
export function ipoToOutcomeSource(ipo: Ipo): OutcomeSource {
  return {
    code: ipo.code,
    name: ipo.name,
    market: ipo.market,
    listingDate: ipo.listingDate,
    offeringPrice: ipo.offeringPrice,
    initialPrice: ipo.initialPrice,
    absorptionAmount: ipo.absorptionAmount > 0 ? ipo.absorptionAmount : null,
    offeringRatio: ipo.offeringRatio > 0 ? ipo.offeringRatio : null,
    leadUnderwriter: ipo.leadUnderwriter.trim() === "" ? null : ipo.leadUnderwriter,
    status: ipo.status,
  };
}

/** HistoricalIpo → OutcomeSource。履歴は全件上場済みとして扱う。 */
export function historicalToOutcomeSource(h: HistoricalIpo): OutcomeSource {
  return {
    code: h.code,
    name: h.name,
    market: h.market,
    listingDate: h.listingDate,
    offeringPrice: h.offeringPrice,
    initialPrice: h.initialPrice,
    absorptionAmount: h.absorptionAmount,
    offeringRatio: h.offeringRatio,
    leadUnderwriter: h.leadUnderwriter,
    status: "listed",
  };
}

/**
 * 現行データと履歴を結合する。同じ「コード×上場日」が両方にあれば現行データを優先する。
 * コードは再利用されうるため、コードだけでは重複扱いにしない。
 */
export function combineOutcomeSources(
  ipos: readonly Ipo[],
  history: readonly HistoricalIpo[],
): OutcomeSource[] {
  const current = ipos.map(ipoToOutcomeSource);
  const seen = new Set(current.map((s) => `${s.code}|${s.listingDate}`));
  const past = history
    .filter((h) => !seen.has(`${h.code}|${h.listingDate}`))
    .map(historicalToOutcomeSource);
  return [...current, ...past];
}
