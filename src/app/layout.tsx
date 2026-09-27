import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { TopBar } from "@/components/nav/TopBar";
import { BottomTabBar } from "@/components/nav/BottomTabBar";
import { RegisterSw } from "@/components/pwa/RegisterSw";
import { SyncAutoRunner } from "@/components/settings/SyncSection";

export const metadata: Metadata = {
  title: "IPO Radar",
  description:
    "日本のIPO銘柄の情報を整理し、需給・ファンダの2軸スコアで機械的に比較する個人用ツール。公開情報を機械的に取得したもので正確性・完全性を保証しません。",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "IPO Radar",
  },
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1f1f1f" },
    { media: "(prefers-color-scheme: light)", color: "#f9f9f9" },
  ],
};

// 初期描画のちらつき防止用の同期スクリプト。
// localStorage "ipo-analyzer:theme:v1" を読み、"dark"/"light" のときのみ
// data-theme を付与する（"auto" またはキー無しはメディアクエリに委ねる）。
const THEME_SYNC_SCRIPT = `
(function () {
  try {
    var mode = localStorage.getItem("ipo-analyzer:theme:v1");
    if (mode) mode = JSON.parse(mode);
    if (mode === "dark" || mode === "light") {
      document.documentElement.setAttribute("data-theme", mode);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`h-full antialiased ${roboto.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SYNC_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-text">
        <TopBar />
        <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-3 pb-[calc(72px+env(safe-area-inset-bottom))] lg:max-w-5xl">
          {children}
        </main>
        <BottomTabBar />
        <RegisterSw />
        <SyncAutoRunner />
      </body>
    </html>
  );
}
