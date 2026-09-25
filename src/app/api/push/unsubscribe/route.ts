import { NextResponse } from "next/server";
import { getPushKv } from "@/lib/push/kv";
import { deleteSubscriber, parseUnsubscribeBody } from "@/lib/push/subscription";

// プッシュ通知の購読解除（KV から削除）。

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

  const parsed = parseUnsubscribeBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await deleteSubscriber(kv, parsed.value);
  return NextResponse.json({ ok: true });
}
