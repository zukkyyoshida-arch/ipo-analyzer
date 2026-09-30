"use client";

// 銘柄詳細の「セカンダリー」: 予想初値（上場前）と、初値が付いた後の線（ストップ高・利確線・損切り線など）。
// 検証: scratch/backtest/report-secondary.md／secondary_run.log。参考情報であり売買推奨ではない。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Ipo } from "@/types/ipo";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { fetchQuote, type QuoteResponse } from "@/lib/quote";
import { formatYen } from "@/lib/format";
import { jstTodayIso } from "@/lib/date";
import { hasSplit, roundPrice, splitFactor, toCurrentScale } from "@/lib/price";
import { useSecondaryProfile } from "@/hooks/useSecondaryProfile";
import {
  isForecastUsable,
  reachRatio,
  type InitialForecast,
} from "@/lib/secondary/initialForecast";
import { preOpenUpperLimit } from "@/lib/secondary/priceLimits";
import {
  buildSecondaryLines,
  describePosition,
  resolveBasePrice,
  type LineKind,
} from "@/lib/secondary/lines";
import {
  RATIO_BAND_STATS,
  SECONDARY_STYLE_LABELS,
  formatSignedPct,
  horizonLabel,
  lookupHitRates,
  ratioBandOf,
  type SecondaryProfile,
} from "@/lib/secondary/profiles";

/** 株価の取得日数（前日終値が取れれば足りる）。 */
const QUOTE_DAYS = 5;

function formatRatio(value: number): string {
  return `×${value.toFixed(2)}`;
}

/** 価格の表示（分割換算で小数が出たら0.1円単位）。 */
function yen(value: number): string {
  return formatYen(roundPrice(value));
}

/**
 * @param ipo 銘柄（公開価格・初値は上場時の単位）
 * @param forecast 予想初値（サーバー側で算出。公開価格が無い銘柄は null）
 * @param todayIso サーバー側の今日（SSG ではビルド日。マウント後に日本時間の今日へ更新する）
 */
export function SecondaryCard({
  ipo,
  forecast,
  todayIso,
}: {
  ipo: Ipo;
  forecast: InitialForecast | null;
  todayIso: string;
}) {
  const { profile } = useSecondaryProfile();
  const usableForecast = isForecastUsable(forecast) ? forecast : null;
  const hasInitial = ipo.initialPrice !== null && ipo.initialPrice > 0;

  return (
    <Card className="p-4">
      {usableForecast ? (
        <ForecastBlock ipo={ipo} forecast={usableForecast} compact={hasInitial} />
      ) : !hasInitial ? (
        <p className="text-xs text-muted">
          {ipo.offeringPrice === null
            ? "公開価格が決まると、予想初値を表示します。"
            : "未取得の項目が多いため、予想初値は出していません。"}
        </p>
      ) : null}

      {!hasInitial && ipo.status === "listed" && ipo.offeringPrice !== null ? (
        <p className="mt-3 text-xs text-muted">
          初値が付く前の気配の上限: {formatYen(preOpenUpperLimit(ipo.offeringPrice))}
          （公開価格の2.3倍）
        </p>
      ) : null}

      {hasInitial ? (
        <InitialBlock
          ipo={ipo}
          initialPrice={ipo.initialPrice as number}
          profile={profile}
          todayIso={todayIso}
          withTopBorder={usableForecast !== null}
        />
      ) : null}

      <div className="mt-3 border-t border-border pt-3">
        <p className="text-[11px] text-subtle">
          判断材料であり売買推奨ではありません。利確線は勝率と損の形を変えますが、過去データでは平均を増やしませんでした。検証は2024〜2026年・167銘柄。
        </p>
        <Link
          href="/settings#secondary"
          prefetch={false}
          className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-accent"
        >
          型を変える（いま: {SECONDARY_STYLE_LABELS[profile.style]}）→
        </Link>
      </div>
    </Card>
  );
}

function ForecastBlock({
  ipo,
  forecast,
  compact,
}: {
  ipo: Ipo;
  forecast: InitialForecast;
  compact: boolean;
}) {
  const split = hasSplit(ipo);
  const cover80 = Math.round(forecast.validation.cover80 * 100);
  const reach = reachRatio(ipo.initialPrice, forecast.centerPrice);

  if (compact) {
    return (
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-muted">
            予想初値 {formatYen(forecast.centerPrice)}
            <span className="ml-1">（80%レンジ {formatYen(forecast.range80.low)}〜{formatYen(forecast.range80.high)}）</span>
          </p>
          {reach !== null ? (
            <p className="text-sm font-medium text-text tabular-nums">
              予想比 {formatRatio(reach)}
              <span className="ml-1 text-[11px] font-normal text-muted">参考</span>
            </p>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-subtle">
          予想を上回ったか下回ったかと、その後の値動きには関係が見られませんでした（参考表示）。
          {split ? " 予想初値は上場時の単位です。" : ""}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted">予想初値</p>
      <p className="mt-1 text-2xl font-medium tabular-nums text-text">
        {forecast.centerPrice.toLocaleString()}
        <span className="ml-0.5 text-base">円</span>
        <span className="ml-2 text-sm font-normal text-muted">
          公開価格の{formatRatio(forecast.ratioToOffering)}
        </span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-[11px] text-muted">50%レンジ</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-text">
            {formatYen(forecast.range50.low)}〜{formatYen(forecast.range50.high)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">80%レンジ</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-text">
            {formatYen(forecast.range80.low)}〜{formatYen(forecast.range80.high)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-subtle">
        2015〜2023年の{forecast.sampleCount.toLocaleString()}件から推定。2024年以降の検証で80%レンジに{cover80}%が収まった（{forecast.validation.n}件）。
        {forecast.missingCount > 0
          ? ` 未取得のため平均値で補った項目: ${forecast.missingFeatures.join("・")}。`
          : ""}
      </p>
    </div>
  );
}

/** 線の色（文字色だけ。値動きの向きに合わせる）。 */
const LINE_TONE: Record<LineKind, string> = {
  stopHigh: "text-up",
  takeProfit: "text-up",
  initial: "text-text",
  stopLoss: "text-down",
  stopLow: "text-down",
};

function InitialBlock({
  ipo,
  initialPrice,
  profile,
  todayIso,
  withTopBorder,
}: {
  ipo: Ipo;
  initialPrice: number;
  profile: SecondaryProfile;
  todayIso: string;
  withTopBorder: boolean;
}) {
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteState, setQuoteState] = useState<"loading" | "ready" | "failed">("loading");
  // SSG のため props.todayIso はビルド日。初回描画はそれで揃え、マウント後に今日へ更新する（PriceCard と同じ作法）。
  const [today, setToday] = useState(todayIso);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(jstTodayIso());
  }, []);

  // 株価はマウント時に1回だけ取得する（再取得・ポーリングはしない）。失敗時は初値基準で表示する。
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuote(null);
    setQuoteState("loading");
    fetchQuote(ipo.code, controller.signal, QUOTE_DAYS).then((res) => {
      if (controller.signal.aborted) return;
      setQuote(res);
      setQuoteState(res ? "ready" : "failed");
    });
    return () => controller.abort();
  }, [ipo.code]);

  const offering = ipo.offeringPrice;
  const ratio = offering !== null && offering > 0 ? initialPrice / offering : null;
  const band = ratio !== null ? RATIO_BAND_STATS[ratioBandOf(ratio)] : null;
  const overheated = ratio !== null && ratio > profile.overheatRatio;

  const factor = splitFactor(ipo);
  const initialCurrent = toCurrentScale(initialPrice, ipo);
  const base = useMemo(
    () =>
      resolveBasePrice({
        todayIso: today,
        listingDate: ipo.listingDate,
        initialCurrent,
        quote: quoteState === "ready" ? quote : null,
      }),
    [today, ipo.listingDate, initialCurrent, quote, quoteState],
  );
  const lines = useMemo(
    () => buildSecondaryLines({ initialListing: initialPrice, factor, base: base.price, profile }),
    [initialPrice, factor, base.price, profile],
  );
  const entryLines = lines.filter((l) => l.kind !== "stopHigh" && l.kind !== "stopLow");
  const limitLines = lines.filter((l) => l.kind === "stopHigh" || l.kind === "stopLow");
  const hit = lookupHitRates(profile);
  const current = quoteState === "ready" && quote ? quote.price : null;

  return (
    <div className={withTopBorder ? "mt-3 border-t border-border pt-3" : ""}>
      {ratio !== null && band !== null ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium tabular-nums text-text">
              初値倍率 ×{ratio.toFixed(2)}
            </p>
            {overheated ? (
              <Chip tone="warn">
                過去データでは5営業日以降が不利（20営業日後 平均{" "}
                {formatSignedPct(band.day20.meanPct)}・勝率{band.day20.winRatePct}%）
              </Chip>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-subtle">
            {overheated
              ? `設定した注意ライン（${profile.overheatRatio.toFixed(1)}倍）を超えています。`
              : `この帯（${band.label}）の20営業日後: 平均 ${formatSignedPct(band.day20.meanPct)}・勝率${band.day20.winRatePct}%。`}
            当日・翌日の終値では、初値倍率による差ははっきりしませんでした。
          </p>
        </div>
      ) : null}

      <div className={ratio !== null ? "mt-3" : ""}>
        <p className="text-[11px] text-muted">
          初値で買った場合の線（{SECONDARY_STYLE_LABELS[profile.style]}の型）
        </p>
        <table className="mt-1 w-full text-xs">
          <tbody>
            {entryLines.map((line) => (
              <tr key={line.kind} className="border-b border-border last:border-b-0">
                <th scope="row" className="py-2 pr-2 text-left font-normal text-muted">
                  {line.label}
                  {line.kind === "takeProfit" || line.kind === "stopLoss" ? (
                    <span className="mt-0.5 block text-[11px] text-subtle">
                      {horizonLabel(hit.horizon)}に届いた割合{" "}
                      {Math.round(
                        line.kind === "takeProfit" ? hit.takeProfitRate : hit.stopLossRate,
                      )}
                      %
                      {(line.kind === "takeProfit" ? hit.takeProfitApprox : hit.stopLossApprox) ||
                      hit.horizonApprox
                        ? "（近い値）"
                        : ""}
                    </span>
                  ) : null}
                </th>
                <td
                  className={`py-2 text-right align-top font-medium tabular-nums ${LINE_TONE[line.kind]}`}
                >
                  {yen(line.price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 rounded-lg bg-surface-2 p-3">
          <p className="text-[11px] text-muted">
            {base.label} {yen(base.price)}
            {quoteState === "loading" ? "（株価を読み込み中）" : null}
            {base.source === "initialFallback" && quoteState === "failed"
              ? "（株価を取得できなかったため初日基準）"
              : null}
          </p>
          <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
            {limitLines.map((line) => (
              <div key={line.kind}>
                <p className="text-[11px] text-muted">{line.label}</p>
                <p className={`mt-0.5 font-medium tabular-nums ${LINE_TONE[line.kind]}`}>
                  {yen(line.price)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {current !== null ? (
          <p className="mt-2 text-xs text-text">
            現在値 {yen(current)} は{describePosition(current, lines)}。
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-subtle">
          届いた割合は、初値で買った場合に高値・安値が線に届いた割合（2024〜2026年・{hit.n}銘柄。どちらが先かは問わない）。
          {hasSplit(ipo) ? " 株式分割を反映し、初値基準の線を現在の株価の単位に換算しています。" : ""}
        </p>
      </div>
    </div>
  );
}
