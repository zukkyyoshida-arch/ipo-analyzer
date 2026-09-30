import type { BbState, NotesState, WatchlistState } from "@/types/userData";
import type { SecondaryProfile } from "@/lib/secondary/profiles";

// 端末間同期の型。localStorage の既存キーと型はそのまま使い、同期用の入れ物だけを足す。

/** 同期対象の localStorage キー（既存。変更しない）。 */
export const SYNC_TARGET_KEYS = {
  watchlist: "ipo-analyzer:watchlist:v1",
  bb: "ipo-analyzer:bb:v1",
  notes: "ipo-analyzer:notes:v1",
  /** セカンダリーの型（任意。未設定の端末には無い） */
  secondary: "ipo-analyzer:secondary:v1",
} as const;

/** 同期設定の localStorage キー。 */
export const SYNC_CONFIG_KEY = "ipo-analyzer:sync:v1";

/** 同期キーを載せる HTTP ヘッダ名。 */
export const SYNC_KEY_HEADER = "X-Sync-Key";

/** 1 キーあたりの保存上限（JSON 文字列の長さ）。 */
export const MAX_SYNC_PAYLOAD_CHARS = 512 * 1024;

/** 同期するユーザーデータ一式（ウォッチ・BB記録・メモ・セカンダリーの型）。 */
export interface SyncData {
  watchlist: WatchlistState;
  bb: BbState;
  notes: NotesState;
  /**
   * セカンダリーの型（後方互換の任意項目）。旧版の端末・サーバーは知らないので落とすことがある。
   * その場合もマージでローカルの値を消さない（src/lib/sync/merge.ts の mergeSecondary）。
   */
  secondary?: SecondaryProfile;
}

/** サーバーに保存する形。v はスキーマ版。 */
export interface SyncPayload {
  v: 1;
  data: SyncData;
  /** 保存した時刻（ISO） */
  updatedAt: string;
}

/** 端末側の同期設定（`ipo-analyzer:sync:v1`）。 */
export interface SyncConfig {
  key: string;
  /** 最後に同期できた時刻（ISO）。未同期なら null */
  lastSyncedAt: string | null;
  /** 前回同期時点のデータ。ローカルの変更検知（差分）に使う。未同期なら null */
  snapshot?: SyncData | null;
}

/** GET /api/sync の応答。未保存のキーなら payload は null。 */
export interface SyncGetResponse {
  payload: SyncPayload | null;
}

/** PUT /api/sync の応答。 */
export interface SyncPutResponse {
  ok: true;
  updatedAt: string;
}
