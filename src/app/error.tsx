"use client";

import Link from "next/link";
import { useEffect } from "react";

/** デプロイ直後に古い画面から遷移したときの「JS の断片が見つからない」系のエラーか。 */
function isStaleChunkError(error: Error): boolean {
  const text = `${error.name} ${error.message}`;
  return (
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(text)
  );
}

const RELOAD_FLAG = "kabu-radar.error-reloaded";

/**
 * 画面の読み込みに失敗したときの表示。
 * 開きっぱなしの古い画面から新しいデプロイ後に遷移すると JS の断片が取れずここに来るため、
 * その場合は一度だけ自動で丸ごと再読み込みする（ループ防止に sessionStorage の印を使う）。
 * 「再読み込み」ボタンも部分的な再描画ではなくページ全体の再読み込みにする。
 */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
    if (!isStaleChunkError(error)) return;
    try {
      if (window.sessionStorage.getItem(RELOAD_FLAG)) return;
      window.sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      // sessionStorage が使えない環境でも再読み込み自体は試す
    }
    window.location.reload();
  }, [error]);

  useEffect(() => {
    // 正常に表示できたあと（次回のエラーまで）に印を消す。
    const t = window.setTimeout(() => {
      try {
        window.sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // noop
      }
    }, 5000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center">
      <h1 className="text-base font-medium">読み込めませんでした</h1>
      <p className="mt-2 text-sm text-muted">
        時間をおいて、もう一度お試しください。
      </p>
      <div className="mt-4 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent"
        >
          再読み込み
        </button>
        <Link
          href="/"
          className="rounded-full border border-border px-4 py-2 text-sm"
        >
          ホームへ
        </Link>
      </div>
    </div>
  );
}
