"use client";

import type { Sentiment } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import type { SentimentMode } from "@/hooks/useSettings";

// 地合いの表示バナー。自動判定値（またはユーザーの手動上書き値）を中立表現で示す。
// 特定銘柄の推奨ではなく、市場全体の状況の機械的な整理である旨を明示する。

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  strong: "強い",
  neutral: "普通",
  weak: "弱い",
};

const SENTIMENT_CLASS: Record<Sentiment, string> = {
  strong: "bg-emerald-50 text-emerald-800 border-emerald-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
  weak: "bg-rose-50 text-rose-800 border-rose-200",
};

const TREND_LABEL = { up: "上向き", flat: "横ばい", down: "下向き" } as const;

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function SentimentBanner({
  sentiment,
  mode,
  market,
  className = "",
}: {
  sentiment: Sentiment;
  mode: SentimentMode;
  market: MarketData;
  className?: string;
}) {
  const { indicators } = market;
  const source = mode === "auto" ? "自動判定" : "手動上書き";
  const avg = indicators.recentIpoAvgReturn;

  return (
    <div
      className={`rounded-xl border p-3 text-sm ${SENTIMENT_CLASS[sentiment]} ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold">地合い: {SENTIMENT_LABEL[sentiment]}</span>
        <span className="text-xs opacity-80">
          （{source} · 更新 {formatUpdatedAt(market.updatedAt)}）
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed opacity-80">
        日経平均トレンド: {TREND_LABEL[indicators.nikkeiTrend]} / グロース250:{" "}
        {TREND_LABEL[indicators.growth250Trend]} / 直近上場の初値騰落率平均:{" "}
        {avg === null ? "データなし" : `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`}
      </p>
    </div>
  );
}
