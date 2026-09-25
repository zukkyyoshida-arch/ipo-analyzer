import { NextResponse } from "next/server";
import { getSyncDb, readSyncRow, writeSyncRow } from "@/lib/sync/d1";
import { hashSyncKey, normalizeSyncKey } from "@/lib/sync/key";
import { isSyncDataShape, normalizeSyncData } from "@/lib/sync/merge";
import {
  MAX_SYNC_PAYLOAD_CHARS,
  SYNC_KEY_HEADER,
  type SyncGetResponse,
  type SyncPayload,
  type SyncPutResponse,
} from "@/lib/sync/types";

// 端末間同期。X-Sync-Key の SHA-256 をキーに、ウォッチ・BB記録・メモの JSON を D1（SYNC_DB）へ保存/取得する。
// キーそのものは保存しない。キー無し/形式不正は 401、D1 未設定は 503。

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function keyHashFrom(request: Request): Promise<string | null> {
  const key = normalizeSyncKey(request.headers.get(SYNC_KEY_HEADER));
  return key ? hashSyncKey(key) : null;
}

function parseStoredPayload(raw: string): SyncPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SyncPayload>;
    if (!parsed || typeof parsed.updatedAt !== "string") return null;
    return { v: 1, data: normalizeSyncData(parsed.data), updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const keyHash = await keyHashFrom(request);
  if (!keyHash) {
    return NextResponse.json({ error: "invalid sync key" }, { status: 401, headers: NO_STORE });
  }
  const db = await getSyncDb();
  if (!db) {
    return NextResponse.json({ error: "db unavailable" }, { status: 503, headers: NO_STORE });
  }

  const row = await readSyncRow(db, keyHash);
  const body: SyncGetResponse = { payload: row ? parseStoredPayload(row.payload) : null };
  return NextResponse.json(body, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  const keyHash = await keyHashFrom(request);
  if (!keyHash) {
    return NextResponse.json({ error: "invalid sync key" }, { status: 401, headers: NO_STORE });
  }
  const db = await getSyncDb();
  if (!db) {
    return NextResponse.json({ error: "db unavailable" }, { status: 503, headers: NO_STORE });
  }

  const text = await request.text();
  if (text.length > MAX_SYNC_PAYLOAD_CHARS) {
    return NextResponse.json({ error: "payload too large" }, { status: 413, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400, headers: NO_STORE });
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!isSyncDataShape(data)) {
    return NextResponse.json({ error: "invalid data" }, { status: 400, headers: NO_STORE });
  }

  const updatedAt = new Date().toISOString();
  const payload: SyncPayload = { v: 1, data: normalizeSyncData(data), updatedAt };
  await writeSyncRow(db, keyHash, JSON.stringify(payload), updatedAt);
  const res: SyncPutResponse = { ok: true, updatedAt };
  return NextResponse.json(res, { headers: NO_STORE });
}
