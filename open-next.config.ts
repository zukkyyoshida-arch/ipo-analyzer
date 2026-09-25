import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// 無料枠で完結させる構成。ISRの再検証（revalidateTag/revalidatePath）は使わず、
// ビルド時点のプリレンダー結果をそのまま配信する「zero-infrastructure」キャッシュ。
// データを更新したい場合は `npm run update:data` → 再デプロイで反映する運用にする。
//
// import パスは @opennextjs/cloudflare@1.20.6 の package.json exports
// （"./*" -> "dist/api/*.js"）により "overrides/..." が "dist/api/overrides/..."
// に解決される。実ファイル存在を確認済み（node_modules/@opennextjs/cloudflare/dist/api/overrides/incremental-cache/static-assets-incremental-cache.js）。
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
