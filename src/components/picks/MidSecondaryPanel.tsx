import type { ReactNode } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { formatDate } from "@/lib/format";
import { formatMonthDay, isHotStale } from "@/lib/hot/file";
import { MID_TIERS, type MidFile } from "@/lib/midterm/file";
import {
  MID_BACKTEST,
  MID_HOLD_BUSINESS_DAYS,
  MID_PASS_TIER,
  type MidCheckResult,
  type MidSecondaryPick,
} from "@/lib/picks/midSecondary";

// 行の格子。スマホは「順位・コード・銘柄・下落率」の下に数字の帯、1280px では数字を列に並べる
// （注目度ランキング・短期セカンダリと同じ組み方）。
const ROW_GRID =
  "grid grid-cols-[1rem_2.5rem_minmax(0,1fr)_auto] gap-x-3 lg:grid-cols-[1rem_2.5rem_minmax(0,1fr)_24rem_4.5rem]";

const METRIC_LABELS = ["上場来高値", "終値", "安値から", "出来高/日"] as const;

const DOT_CLASS: Record<MidCheckResult["verdict"], string> = {
  pass: "bg-up",
  warn: "bg-warn",
  fail: "bg-down",
  unknown: "bg-border",
};

const VERDICT_LABEL: Record<MidCheckResult["verdict"], string> = {
  pass: "クリア",
  warn: "注意",
  fail: "警戒",
  unknown: "不明",
};

const REASON_TONE = { good: "up", warn: "warn", bad: "down" } as const;

function yen(v: number): string {
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

function pct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function volumeJa(v: number | null): string {
  if (v === null) return "—";
  return v >= 10_000 ? `${Math.round(v / 1000) / 10}万株` : `${Math.round(v).toLocaleString("ja-JP")}株`;
}

/**
 * ホームの「ピックアップ」→「中長期セカンダリ」の候補一覧（注目度ランキングの下に並べる）。
 * 上場来高値から −60% に届き、警戒の無い銘柄を候補として上に、−40%・−50% の段階や警戒のある銘柄は折りたたみに出す。
 * 判定は lib/picks/midSecondary.ts（rankMidSecondary）で済ませ、ここは表示だけ。
 * @param picks rankMidSecondary の結果
 * @param file midterm.json（基準日・対象数・古さの判定に使う。無ければ null）
 * @param todayIso 日本時間の今日
 */
export function MidSecondaryPanel({
  picks,
  file,
  todayIso,
}: {
  picks: MidSecondaryPick[];
  file: MidFile | null;
  todayIso: string;
}) {
  const stale = file === null || file.asOf === "" || isHotStale(file.asOf, todayIso);
  const candidates = picks.filter((p) => p.candidate);
  const others = picks.filter((p) => !p.candidate);
  const b = MID_BACKTEST;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-text">中長期セカンダリ（高値から −{MID_PASS_TIER}%）</h2>
        {!stale ? (
          <span className="shrink-0 text-xs tabular-nums text-subtle">{formatMonthDay(file.asOf)} 終値時点</span>
        ) : (
          <Chip tone="warn">更新待ち</Chip>
        )}
      </div>

      {stale ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted">
            次の終値データで集計すると、上場来高値から大きく下げた銘柄をここへ表示します
          </p>
          {file && file.asOf ? (
            <p className="mt-2 text-xs tabular-nums text-subtle">前回の集計: {formatDate(file.asOf)} 終値時点</p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-0.5 text-xs tabular-nums text-subtle">
            上場1年以内 {file.universe} 銘柄のうち −40% 以下 {picks.length}・候補 {candidates.length}
          </p>
          <ListHeader />
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              いま −{MID_PASS_TIER}% に届いていて、警戒の付かない銘柄はありません
            </p>
          ) : (
            <ol>
              {candidates.map((pick, i) => (
                <MidRow key={pick.item.code} rank={i + 1} pick={pick} />
              ))}
            </ol>
          )}

          {others.length > 0 ? (
            <details className="mt-2 border-t border-border">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-text marker:content-none">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block text-muted">▶</span>
                  段階だけ・警戒あり（{others.length}）
                </span>
              </summary>
              <ol>
                {others.map((pick, i) => (
                  <MidRow key={pick.item.code} rank={i + 1} pick={pick} />
                ))}
              </ol>
            </details>
          ) : null}

          <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
            <p>
              入る目安: 上場来高値から −{b.tier}% に初めて届いた翌営業日の寄り付き。出る目安: {b.holdDays} 営業日後の引け。
              利確・損切りの幅は固定していません（+10%／−10% で機械的に切ると、検証の平均が +{b.meanPct}% から +{b.fixedExitMeanPct}% に下がりました）。
            </p>
            <p>
              過去検証（{b.period}）: −{b.tier}% 到達の翌日に買い {b.holdDays} 営業日後に売ると平均 +{b.meanPct}%（95%
              信頼区間 +{b.ciLowPct}〜+{b.ciHighPct}%、勝率 {b.winRatePct}%、{b.n} 件）、60 営業日後は平均 +{b.hold60MeanPct}%（勝率{" "}
              {b.hold60WinRatePct}%）。−40%・−50% は根拠が無いため段階の表示だけです。
            </p>
            <p>
              出来高の減少・安値からの反発を待つ条件は検証で効果が無く（反発待ちはむしろ悪化）、判定に使っていません。安値からの戻りは表示だけです。決算をまたぐ影響は件数が足りず未検証なので、保有の目安（{MID_HOLD_BUSINESS_DAYS}{" "}
              営業日）の間に決算が来る銘柄は注意にしています。決算日が無い銘柄は決算期から推定しています。
            </p>
            <p>判断材料であり売買推奨ではありません。</p>
          </div>
        </>
      )}
    </section>
  );
}

function ListHeader() {
  return (
    <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
      <span className="col-span-3">銘柄</span>
      <span className="hidden lg:col-start-4 lg:grid lg:grid-cols-4 lg:gap-1">
        {METRIC_LABELS.map((label) => (
          <span key={label} className="text-right">
            {label}
          </span>
        ))}
      </span>
      <span className="col-start-4 text-right lg:col-start-5">下落率</span>
    </div>
  );
}

/** −40/−50/−60 の段階バッジ。届いた段階は塗り、届いていない段階は薄く。 */
function TierBadges({ drawdown }: { drawdown: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`上場来高値から ${pct(drawdown)}`}>
      {MID_TIERS.map((t) => {
        const reached = drawdown <= -t / 100 + 1e-9;
        const tone = !reached ? "text-subtle" : t >= MID_PASS_TIER ? "text-up" : "text-warn";
        return (
          <span
            key={t}
            className={`rounded px-1 text-[10px] font-medium tabular-nums ${reached ? "bg-surface-2" : ""} ${tone}`}
          >
            −{t}
          </span>
        );
      })}
    </span>
  );
}

/** チェック結果のドット（表示だけの項目は枠線）。 */
function CheckDots({ checks }: { checks: MidCheckResult[] }) {
  return (
    <span className="inline-flex items-center gap-1" role="list" aria-label="チェック">
      {checks.map((c) => (
        <span
          key={c.id}
          role="listitem"
          title={`${c.label}: ${c.value}（${c.displayOnly ? "表示だけ" : VERDICT_LABEL[c.verdict]}）`}
          aria-label={`${c.label} ${c.displayOnly ? "表示だけ" : VERDICT_LABEL[c.verdict]}`}
          className={`inline-block h-2 w-2 rounded-full ${c.displayOnly ? "border border-subtle" : DOT_CLASS[c.verdict]}`}
        />
      ))}
    </span>
  );
}

function MidRow({ rank, pick }: { rank: number; pick: MidSecondaryPick }) {
  const { item } = pick;
  const hit = item.hits[`${MID_PASS_TIER}`];
  const metrics: { label: (typeof METRIC_LABELS)[number]; value: ReactNode }[] = [
    { label: "上場来高値", value: yen(item.ath) },
    { label: "終値", value: yen(item.close) },
    { label: "安値から", value: pct(item.rebound) },
    { label: "出来高/日", value: volumeJa(item.avgVolume20) },
  ];

  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={`/ipo/${item.code}`}
        prefetch={false}
        className={`${ROW_GRID} items-center py-3 active:opacity-80`}
      >
        <span className="col-start-1 row-start-1 text-center text-sm tabular-nums text-muted">{rank}</span>
        <span className="col-start-2 row-start-1 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
          {item.code}
        </span>
        <span className="col-start-3 row-start-1 min-w-0">
          <span className="block truncate text-sm text-text">{item.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-subtle">
            <TierBadges drawdown={item.drawdown} />
            <CheckDots checks={pick.checks} />
            {hit ? (
              <span>
                −{MID_PASS_TIER}% 初到達 {formatMonthDay(hit)}
              </span>
            ) : item.listingDate ? (
              <span>上場 {formatMonthDay(item.listingDate)}</span>
            ) : null}
          </span>
          {pick.reasons.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {pick.reasons.map((r) => (
                <Chip key={r.id} tone={REASON_TONE[r.tone]}>
                  {r.text}
                </Chip>
              ))}
            </span>
          ) : null}
        </span>
        <span className="col-start-4 row-start-1 flex flex-col items-end lg:col-start-5">
          <span className="text-base font-medium leading-none tabular-nums text-down">{pct(item.drawdown)}</span>
          <span className="mt-1 text-[11px] text-subtle">高値から</span>
        </span>
        <span className="col-span-4 col-start-1 row-start-2 mt-2 grid grid-cols-4 gap-1 rounded-lg bg-surface-2 px-2 py-1.5 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:mt-0 lg:bg-transparent lg:p-0">
          {metrics.map((m) => (
            <span key={m.label} className="flex min-w-0 flex-col lg:items-end">
              <span className="text-[11px] text-muted lg:hidden">{m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}
