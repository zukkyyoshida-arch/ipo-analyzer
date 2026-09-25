import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/push/kv";

// クライアントの pushManager.subscribe に渡す VAPID 公開鍵を返す（公開鍵のみ・秘密鍵は返さない）。

export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "vapid key unavailable" }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
