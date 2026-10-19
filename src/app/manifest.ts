import type { MetadataRoute } from "next";

const SHORTCUT_ICONS = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "カブレーダー",
    short_name: "カブレーダー",
    description:
      "日本のIPO銘柄の情報を整理し、需給・ファンダの2軸スコアで機械的に比較する個人用ツール。",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1f1f1f",
    theme_color: "#1f1f1f",
    lang: "ja",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // ホーム画面アイコンの長押しメニュー。android-twa/twa-manifest.json の shortcuts と揃える。
    shortcuts: [
      { name: "銘柄一覧", short_name: "銘柄", url: "/ipos", icons: SHORTCUT_ICONS },
      { name: "BB管理", short_name: "BB", url: "/bb", icons: SHORTCUT_ICONS },
      { name: "予定", short_name: "予定", url: "/events", icons: SHORTCUT_ICONS },
    ],
  };
}
