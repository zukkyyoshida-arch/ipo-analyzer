"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Ipo } from "@/types/ipo";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/ui/Sparkline";
import { determinePhase } from "@/lib/checklist/phase";
import { PriceChange } from "@/components/ui/PriceChange";
import { DEFAULT_QUOTE_DAYS, fetchQuote, type QuoteResponse } from "@/lib/quote";
import { recentCloses, toOhlcBars } from "@/lib/chart/ohlc";
import { formatYen, initialReturnRate } from "@/lib/format";
import { jstTodayIso } from "@/lib/date";
import {
  formatSplitRatio,
  hasSplit,
  roundPrice,
  splitFactor,
  toCurrentScale,
  toListingScale,
} from "@/lib/price";
import type { PriceReferenceLine } from "./PriceChart";

/** 株価の取得日数（API 上限）。期間切り替え（1M〜1Y）はこの1回の取得分の表示範囲を変えるだけにする。 */
const QUOTE_DAYS = 365;

/** チャート領域の高さ（期間ボタン＋キャンバス）。読み込み中の枠もこの高さで確保してガタつきを防ぐ。 */
function ChartPlaceholder() {
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="h-9" />
      <div className="mt-1 flex h-[320px] items-center justify-center text-xs text-muted sm:h-[400px]">
        読み込み中…
      </div>
    </div>
  );
}

// lightweight-charts（canvas）はブラウザ専用かつ重めなので、詳細ページでチャートを出す時だけ読み込む。
const PriceChart = dynamic(() => import("./PriceChart").then((m) => m.PriceChart), {
  ssr: false,
  loading: () => <ChartPlaceholder />,
});

/** 公開価格比%（現在値が公開価格に対して何%か）。どちらか欠けていれば null。両方とも同じ単位で渡す。 */
function offeringRate(
  currentPrice: number | null,
  offeringPrice: number | null,
): number | null {
  if (currentPrice === null || offeringPrice === null || offeringPrice === 0) {
    return null;
  }
  return ((currentPrice - offeringPrice) / offeringPrice) * 100;
}

/** 上場時の単位の価格を現在の単位に換算して表示用に丸める。null はそのまま。 */
function toCurrentScaleOrNull(value: number | null, ipo: Ipo): number | null {
  return value === null ? null : roundPrice(toCurrentScale(value, ipo));
}

/**
 * 価格カード。公開価格・初値・現在値・初値比・公開価格比%を表示する。
 * マウント後に /api/quote/[code]?days=365 を1回だけ fetch し、成功したらライブ現在値・
 * 直近120日のスパークラインに切り替える。失敗・未取得時は静的 currentPrice を使い、
 * 「前営業日の終値ベース」と小さく注記する。
 * 上場日以降は同じデータで TradingView 風のローソク足チャート（lightweight-charts）を出す。
 *
 * 単位: 公開価格・初値は上場時の単位、現在値・ライブ値・チャートは現在の単位（src/lib/price.ts）。
 * 株式分割があった銘柄は、公開価格・初値を現在の単位に換算して主に出し、上場時の値を併記する。
 * 比率（公募比・初値からの変化）は現在値を上場時の単位に直して計算する。
 * チャートの公開価格・初値の水平線も、日足に合わせて現在の単位に換算して引く。
 */
export function PriceCard({ ipo, todayIso }: { ipo: Ipo; todayIso: string }) {
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  // 取得失敗時の「再読み込み」で増やす（fetch の effect を再実行させる）。
  const [reloadKey, setReloadKey] = useState(0);
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

    fetchQuote(ipo.code, controller.signal, QUOTE_DAYS).then((res) => {
      if (controller.signal.aborted) return;
      if (res) {
        setQuote(res);
      } else {
        setQuoteFailed(true);
      }
    });

    return () => controller.abort();
  }, [ipo.code, reloadKey]);

  const liveCurrentPrice = quote?.price ?? null;
  const staticCurrentPrice = ipo.currentPrice ?? null;
  const currentPrice = liveCurrentPrice ?? staticCurrentPrice;
  const isLive = liveCurrentPrice !== null;

  // 現在値（現在の単位）を上場時の単位に直した値。公開価格・初値との比較に使う。
  const currentAtListing =
    currentPrice === null ? null : toListingScale(currentPrice, ipo);
  const split = hasSplit(ipo);
  const splitRatio = formatSplitRatio(ipo);

  const returnRate = initialReturnRate(ipo);
  const offerRate = offeringRate(currentAtListing, ipo.offeringPrice);
  // 初値からの変化率（現在値/初値）。公開価格が未取得の銘柄でも出せる指標。
  const sinceInitialRate =
    currentAtListing !== null && ipo.initialPrice !== null && ipo.initialPrice > 0
      ? ((currentAtListing - ipo.initialPrice) / ipo.initialPrice) * 100
      : null;
  const bars = useMemo(() => (quote ? toOhlcBars(quote.closes) : []), [quote]);
  // スパークラインは従来どおり直近120日。OHLC が揃わない旧レスポンスでも終値だけで描く。
  const closes = recentCloses(bars.length >= 2 ? bars : (quote?.closes ?? []), DEFAULT_QUOTE_DAYS);
  // 日足は現在の単位（分割調整済み）なので、公開価格・初値の水平線も現在の単位に換算して引く。
  const referenceLines = useMemo(() => {
    const scale = { splitFactor: ipo.splitFactor };
    const lines: PriceReferenceLine[] = [];
    if (ipo.offeringPrice !== null && ipo.offeringPrice > 0) {
      lines.push({
        label: "公開価格",
        price: toCurrentScale(ipo.offeringPrice, scale),
        tone: "accent-2",
      });
    }
    if (ipo.initialPrice !== null && ipo.initialPrice > 0) {
      lines.push({
        label: "初値",
        price: toCurrentScale(ipo.initialPrice, scale),
        tone: "accent",
      });
    }
    return lines;
  }, [ipo.offeringPrice, ipo.initialPrice, ipo.splitFactor]);
  const phase = determinePhase(ipo, today);

  // 分割があれば、公開価格・初値は現在の単位に換算した値を主に出す。
  const offeringShown = split
    ? toCurrentScaleOrNull(ipo.offeringPrice, ipo)
    : ipo.offeringPrice;
  const initialShown = split
    ? toCurrentScaleOrNull(ipo.initialPrice, ipo)
    : ipo.initialPrice;

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <PriceStat
          label="公開価格"
          value={
            ipo.offeringPrice === null && ipo.status === "listed"
              ? "未取得"
              : formatYen(offeringShown)
          }
          sub={
            split && ipo.offeringPrice !== null
              ? `上場時 ${formatYen(ipo.offeringPrice)}`
              : undefined
          }
        />
        <PriceStat
          label="初値"
          value={formatYen(initialShown)}
          sub={
            split && ipo.initialPrice !== null
              ? `上場時 ${formatYen(ipo.initialPrice)}`
              : undefined
          }
        />
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
            <p className="text-[11px] text-muted">公開価格比</p>
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

      {split && splitRatio ? (
        <p className="mt-2 text-[11px] text-muted">
          {splitFactor(ipo) > 1 ? "株式分割" : "株式併合"}（{splitRatio}）を反映して、公開価格・初値を現在の株価の単位に換算しています。
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-muted">
        {isLive
          ? quote?.updatedAt
            ? `ライブ値（取得: ${new Date(quote.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）`
            : "ライブ値"
          : quoteFailed || staticCurrentPrice !== null
            ? "現在値は前営業日の終値ベースです"
            : "現在値は未取得です"}
      </p>

      {phase === "bb" ? null : bars.length > 0 ? (
        <PriceChart
          key={ipo.code}
          bars={bars}
          referenceLines={referenceLines}
          listingDate={ipo.listingDate}
        />
      ) : phase !== "secondary" ? null : quote === null && !quoteFailed ? (
        <ChartPlaceholder />
      ) : (
        <div className="mt-3 flex flex-col items-center gap-2 border-t border-border py-4 text-xs text-muted">
          <p>チャートデータを取得できませんでした。</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="min-h-9 rounded-full bg-surface-2 px-4 text-xs font-medium text-text active:opacity-80"
          >
            再読み込み
          </button>
        </div>
      )}
    </Card>
  );
}

function PriceStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  /** 値の下に小さく添える補足（例: 分割前の上場時の価格） */
  sub?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-text">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}
