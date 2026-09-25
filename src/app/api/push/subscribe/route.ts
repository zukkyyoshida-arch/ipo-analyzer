import { NextResponse } from "next/server";
import { getPushKv } from "@/lib/push/kv";
import { parseSubscribeBody, saveSubscriber } from "@/lib/push/subscription";

// プッシュ通知の購読登録（同じ endpoint は設定の上書き）。保存先は KV（PUSH_SUBSCRIPTIONS）。

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const kv = await getPushKv();
  if (!kv) {
    return NextResponse.json({ error: "kv unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseSubscribeBody(body, new Date().toISOString());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await saveSubscriber(kv, parsed.value);
  return NextResponse.json({
    ok: true,
    enabledKinds: parsed.value.enabledKinds,
    watchedCount: parsed.value.watchedCodes.length,
  });
}
