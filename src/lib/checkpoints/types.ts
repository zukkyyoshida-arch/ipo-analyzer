import type { Ipo } from "@/types/ipo";
import type { IpoEnriched } from "@/types/enriched";

// 手法別チェックポイントの型。既存の投資判断チェックリスト（lib/checklist）と同じ verdict の形。

export type CheckpointVerdict = "pass" | "warn" | "fail" | "unknown";

export interface CheckpointResult {
  id: CommonCheckpointId;
  /** 項目名 */
  label: string;
  verdict: CheckpointVerdict;
  /** この銘柄の値（表示用） */
  value: string;
  /** 判定の基準（表示用） */
  threshold: string;
  /** 判定の理由 */
  reason: string;
}

export type CommonCheckpointId =
  | "growth3y"
  | "offeringMix"
  | "supplyShares"
  | "vc"
  | "lockup"
  | "stockOption"
  | "absorption"
  | "oa"
  | "marketCapScenario";

/** チェックに使う補完データ（Ipo 型に無い項目だけ）。サーバーからクライアントへはこの形だけ渡す。 */
export type CheckpointEnriched = Pick<
  IpoEnriched,
  | "financialHistory"
  | "majorShareholders"
  | "stockOptionShares"
  | "issuedShares"
  | "vcHoldingShares"
  | "vcLockupShares"
>;

export const CHECKPOINT_ENRICHED_KEYS = [
  "financialHistory",
  "majorShareholders",
  "stockOptionShares",
  "issuedShares",
  "vcHoldingShares",
  "vcLockupShares",
] as const satisfies readonly (keyof CheckpointEnriched)[];

export interface CheckpointInput {
  ipo: Ipo;
  enriched?: CheckpointEnriched;
}

export type CheckpointCounts = Record<CheckpointVerdict, number>;

export interface CheckpointSummary {
  items: CheckpointResult[];
  counts: CheckpointCounts;
}

/** enriched レコードから、チェックに使う項目だけを抜き出す（無い項目は付けない）。 */
export function pickCheckpointEnriched(
  e: IpoEnriched | undefined,
): CheckpointEnriched | undefined {
  if (!e) return undefined;
  const out: CheckpointEnriched = {};
  let any = false;
  for (const key of CHECKPOINT_ENRICHED_KEYS) {
    if (e[key] !== undefined) {
      (out as Record<string, unknown>)[key] = e[key];
      any = true;
    }
  }
  return any ? out : undefined;
}
