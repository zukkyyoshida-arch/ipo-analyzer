"use client";

import type { Sentiment } from "@/types/ipo";
import type { MarketData } from "@/types/data";
import type { SentimentMode } from "@/hooks/useSettings";

// 地合いの 1 行チップ。自動判定値（またはユーザーの手動上書き値）を中立表現で示す。
// 判定元・更新時刻は title 属性（長押し／ホバー）で確認できる。

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  strong: "強い",
  neutral: "普通",
  weak: "弱い",
};

const SENTIMENT_DOT: Record<Sentiment, string> = {
  strong: "bg-up",
  neutral: "bg-subtle",
  weak: "bg-down",
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
  const detail = `日経平均 ${TREND_LABEL[indicators.nikkeiTrend]} / グロース250 ${TREND_LABEL[indicators.growth250Trend]} / ${source} · 更新 ${formatUpdatedAt(market.updatedAt)}`;

  return (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-xs ${className}`}
      title={detail}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${SENTIMENT_DOT[sentiment]}`} aria-hidden />
      <span className="shrink-0 font-medium text-text">地合い {SENTIMENT_LABEL[sentiment]}</span>
      <span className="truncate text-muted">
        日経平均 {TREND_LABEL[indicators.nikkeiTrend]} · グロース250{" "}
        {TREND_LABEL[indicators.growth250Trend]}
      </span>
    </div>
  );
}
