import type { CapacitorConfig } from "@capacitor/cli";

// CAP_SERVER_URL が設定されていればデプロイ済みURLをそのまま読み込む（ラッパー方式）。
// 未設定時は `out`（`next build` の静的出力想定）をwebDirとして使う。
// `npx cap add ios/android` は Xcode/Android Studio が必要なため未実行。
// 実行手順は README.md「Capacitor でネイティブ化する」を参照。
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.zukky.apolloipo",
  appName: "IPO Radar",
  webDir: "out",
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: false,
        },
      }
    : {}),
};

export default config;
