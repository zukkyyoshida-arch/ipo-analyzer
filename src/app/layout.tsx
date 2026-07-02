import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Disclaimer } from "@/components/Disclaimer";

export const metadata: Metadata = {
  title: "IPO Analyzer | 日本のIPO銘柄 情報整理ツール",
  description:
    "日本のIPO銘柄の情報を整理し、需給・ファンダの2軸スコアで機械的に比較する個人用ツール（サンプルデータ）。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <Header />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
          {children}
        </main>
        <Disclaimer />
      </body>
    </html>
  );
}
