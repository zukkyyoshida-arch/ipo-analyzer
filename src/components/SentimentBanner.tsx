"use client";

import type { Sentiment } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import type { SentimentMode } from "@/hooks/useSettings";
import { Card } from "./ui/Card";
import { Chip, type ChipTone } from "./ui/Chip";

// 地合いの表示バナー。自動判定値（またはユーザーの手動上書き値）を中立表現で示す。
// 特定銘柄の評価ではなく、市場全体の状況の機械的な整理である旨を明示する。

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  strong: "強い",
  neutral: "普通",
  weak: "弱い",
};

const SENTIMENT_TONE: Record<Sentiment, ChipTone> = {
  strong: "up",
  neutral: "neutral",
  weak: "down",
};

const TREND_LABEL = { up: "上向き", flat: "横ばい", down: "下向き" } as const;

// タイムゾーンをAsia/Tokyoに固定してフォーマットする（実行環境のローカルTZに
// 依存するとSSR/CSRでサーバーとブラウザのTZが異なる場合にhydration mismatchが
// 起きるため）。IPO Radarは日本国内個人利用前提のため常にJST表示でよい。
const UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = UPDATED_AT_FORMATTER.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
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
    <Card className={`p-3 text-sm ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone={SENTIMENT_TONE[sentiment]}>
          地合い: {SENTIMENT_LABEL[sentiment]}
        </Chip>
        <span className="text-xs text-muted">
          （{source} · 更新 {formatUpdatedAt(market.updatedAt)}）
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        日経平均トレンド: {TREND_LABEL[indicators.nikkeiTrend]} / グロース250:{" "}
        {TREND_LABEL[indicators.growth250Trend]} / 直近上場の初値騰落率平均:{" "}
        {avg === null ? "データなし" : `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`}
      </p>
    </Card>
  );
}
