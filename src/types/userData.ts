import type { BbStatus } from "./broker";

// ユーザーが localStorage に保存する入力データの型。

/** 1銘柄×1証券会社の BB 申込レコード */
export interface BbEntry {
  status: BbStatus;
  /** SBI証券のチャレンジポイント投入数などのメモ */
  memo?: string;
}

/** 銘柄コード -> 証券会社ID -> BbEntry */
export type BbState = Record<string, Record<string, BbEntry>>;

/** 銘柄コード -> メモ本文 */
export type NotesState = Record<string, string>;

/** ウォッチリスト（銘柄コードの配列） */
export type WatchlistState = string[];
