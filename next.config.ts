import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// 注: initOpenNextCloudflareForDev() はここでは呼ばない。
// これは `next dev` でCloudflare bindings（KV/R2/Durable Objects等）を
// ローカル再現するための開発体験補助であり、本アプリの構成（wrangler.jsonc の
// bindings は ASSETS と WORKER_SELF_REFERENCE のみで、コード側から bindings を
// 参照する箇所が無い）では不要なため追加しない。
