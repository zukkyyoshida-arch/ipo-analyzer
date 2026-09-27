"use client";

import { useEffect, useRef, useState } from "react";
import type { Ipo } from "@/types/ipo";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";
import { Candlestick, type CandlePoint } from "@/components/ui/Candlestick";
import { determinePhase } from "@/lib/checklist/phase";
import { PriceChange } from "@/components/ui/PriceChange";
import { fetchQuote, type QuotePoint, type QuoteResponse } from "@/lib/quote";
import { formatYen, initialReturnRate } from "@/lib/format";
import { jstTodayIso } from "@/lib/date";

/** 公募比%（現在値が公開価格に対して何%か）。どちらか欠けていれば null。 */
function offeringRate(
  currentPrice: number | null,
  offeringPrice: number | null,
): number | null {
  if (currentPrice === null || offeringPrice === null || offeringPrice === 0) {
    return null;
  }
  return ((currentPrice - offeringPrice) / offeringPrice) * 100;
}

/**
 * 価格カード。公開価格・初値・現在値・初値比%・公募比%を表示する。
 * マウント後に /api/quote/[code] をfetchし、成功したらライブ現在値・前日比・
 * 90日スパークラインに切り替える。失敗・未取得時は静的 currentPrice を使い、
 * 「静的データ」と小さく注記する。
 * セカンダリー期（上場翌日以降）は6ヶ月ローソク足を折りたたみで追加する（開いた時だけ取得）。
 */
export function PriceCard({ ipo, todayIso }: { ipo: Ipo; todayIso: string }) {
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  // 詳細ページは SSG のため props.todayIso はビルド日で固定される。
  // 初回描画はそれで揃え（ハイドレーション一致）、マウント後に日本時間の今日へ更新する。
  const [today, setToday] = useState(todayIso);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(jstTodayIso());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // ipo.code が変わった際に前回の結果を即クリアする（useLocalStorage 等と同様の作法）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuote(null);
    setQuoteFailed(false);

    fetchQuote(ipo.code, controller.signal).then((res) => {
      if (controller.signal.aborted) return;
      if (res) {
        setQuote(res);
      } else {
        setQuoteFailed(true);
      }
    });

    return () => controller.abort();
  }, [ipo.code]);

  const liveCurrentPrice = quote?.price ?? null;
  const staticCurrentPrice = ipo.currentPrice ?? null;
  const currentPrice = liveCurrentPrice ?? staticCurrentPrice;
  const isLive = liveCurrentPrice !== null;

  const returnRate = initialReturnRate(ipo);
  const offerRate = offeringRate(currentPrice, ipo.offeringPrice);
  // 初値からの変化率（現在値/初値）。公開価格が未取得の銘柄でも出せる指標。
  const sinceInitialRate =
    currentPrice !== null && ipo.initialPrice !== null && ipo.initialPrice > 0
      ? ((currentPrice - ipo.initialPrice) / ipo.initialPrice) * 100
      : null;
  const closes = quote?.closes.map((c) => c.close) ?? [];

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <PriceStat
          label="公開価格"
          value={
            ipo.offeringPrice === null && ipo.status === "listed"
              ? "未取得"
              : formatYen(ipo.offeringPrice)
          }
        />
        <PriceStat label="初値" value={formatYen(ipo.initialPrice)} />
        <PriceStat
          label="現在値"
          value={currentPrice === null ? "—" : formatYen(currentPrice)}
        />
        <PriceStat
          label="初値比"
          value={<PriceChange value={returnRate} />}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex gap-4">
          <div>
            <p className="text-[11px] text-muted">公募比%</p>
            <p className="mt-0.5">
              <PriceChange value={offerRate} />
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted">初値からの変化</p>
            <p className="mt-0.5">
              <PriceChange value={sinceInitialRate} />
            </p>
          </div>
        </div>
        {closes.length >= 2 ? (
          <Sparkline data={closes} width={110} height={32} />
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {isLive
          ? quote?.updatedAt
            ? `ライブ値（取得: ${new Date(quote.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）`
            : "ライブ値"
          : quoteFailed || staticCurrentPrice !== null
            ? "静的データ"
            : "現在値は未取得です"}
      </p>

      {determinePhase(ipo, today) === "secondary" ? (
        <SecondaryChart key={ipo.code} ipo={ipo} />
      ) : null}
    </Card>
  );
}

function PriceStat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-text">{value}</p>
    </div>
  );
}

/** 6ヶ月チャートの取得日数。 */
const CHART_DAYS = 180;

type ChartState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; candles: CandlePoint[]; volumes: (number | null)[] };

/** OHLC が揃った日だけをローソク足に変換する（欠損日は描かない）。 */
function toCandles(points: QuotePoint[]): {
  candles: CandlePoint[];
  volumes: (number | null)[];
} {
  const candles: CandlePoint[] = [];
  const volumes: (number | null)[] = [];
  for (const p of points) {
    if (
      typeof p.open !== "number" ||
      typeof p.high !== "number" ||
      typeof p.low !== "number"
    ) {
      continue;
    }
    candles.push({ date: p.date, open: p.open, high: p.high, low: p.low, close: p.close });
    volumes.push(p.volume);
  }
  return { candles, volumes };
}

/** 折りたたみの6ヶ月ローソク足。開いた時に1回だけ ?days=180 で取得する（失敗時は再度開くと再試行）。 */
function SecondaryChart({ ipo }: { ipo: Ipo }) {
  const [state, setState] = useState<ChartState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open) return;
    if (state.kind === "loading" || state.kind === "ready") return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "loading" });
    fetchQuote(ipo.code, controller.signal, CHART_DAYS).then((res) => {
      if (controller.signal.aborted) return;
      const converted = res ? toCandles(res.closes) : null;
      if (!converted || converted.candles.length < 2) {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ready", ...converted });
    });
  }

  const referenceLines: {
    label: string;
    value: number;
    tone: "accent" | "accent-2";
  }[] = [];
  if (ipo.offeringPrice !== null && ipo.offeringPrice > 0) {
    referenceLines.push({ label: "公開価格", value: ipo.offeringPrice, tone: "accent-2" });
  }
  if (ipo.initialPrice !== null && ipo.initialPrice > 0) {
    referenceLines.push({ label: "初値", value: ipo.initialPrice, tone: "accent" });
  }

  return (
    <details className="mt-2 border-t border-border" onToggle={handleToggle}>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block text-muted">▶</span>
          6ヶ月チャート（タップで表示）
        </span>
      </summary>
      <div className="pb-1">
        {state.kind === "ready" ? (
          <Candlestick
            data={state.candles}
            volumes={state.volumes}
            referenceLines={referenceLines}
          />
        ) : state.kind === "error" ? (
          <p className="py-4 text-center text-xs text-muted">
            チャートデータを取得できませんでした。閉じて開き直すと再取得します。
          </p>
        ) : (
          <p className="py-4 text-center text-xs text-muted">読み込み中…</p>
        )}
      </div>
    </details>
  );
}
