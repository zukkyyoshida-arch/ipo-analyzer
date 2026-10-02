"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { YutaiGuide } from "@/components/picks/YutaiGuide";
import { formatMonthDay } from "@/lib/hot/file";
import {
  applyYutaiExclusion,
  parseYutaiSortKey,
  rankYutai,
  sortYutai,
  YUTAI_SORT_OPTIONS,
  type YutaiPick,
  type YutaiReason,
  type YutaiStatsView,
} from "@/lib/picks/yutai";
import { newId } from "@/hooks/usePortfolio";
import { holdingFromYutai, isHeldForYutai } from "@/lib/portfolio/fromYutai";
import type { Holding } from "@/lib/portfolio/types";
import {
  normalizeBudgetMan,
  normalizeSplitCount,
  YUTAI_BUDGET_OPTIONS_MAN,
  YUTAI_DEFAULT_SPLIT,
  YUTAI_SPLIT_OPTIONS,
  YUTAI_TAKE_PROFIT,
  YUTAI_TRAIL_STOP,
  YUTAI_TRAIL_TRIGGER,
  yutaiEntryPlan,
  type YutaiEntryPlan,
} from "@/lib/yutai/entry";
import { earningsInWindow } from "@/lib/yutai/exclude";
import { expectedOutcome, limitOrderPlan, limitOrderPlans, type LimitOrderPlan } from "@/lib/yutai/limitOrders";
import { isYutaiStale, monthLabel, parseYutaiMonthFile } from "@/lib/yutai/file";
import {
  YUTAI_SOURCE,
  prevMonthOf,
  yutaiMonthFileUrl,
  type YutaiBaseline,
  type YutaiMonthFile,
} from "@/lib/yutai/types";

// 行の格子。スマホは「順位・コード・社名・総合点」の下に数字の帯、1280px では数字を列に並べる
// （中長期セカンダリと同じ組み方）。
const ROW_GRID =
  "grid grid-cols-[1.75rem_2.75rem_minmax(0,1fr)_auto] gap-x-2 lg:grid-cols-[1.75rem_2.75rem_minmax(0,1fr)_40rem_4rem] lg:gap-x-3";

const METRIC_LABELS = ["前月平均", "最大上昇 平均", "+10%到達", "株価位置", "最低投資", "推奨買付", "利確目安"] as const;
type MetricLabel = (typeof METRIC_LABELS)[number];

/** 一覧に最初に出す件数と、「さらに見る」で増やす件数。 */
const PAGE_SIZE = 50;

const REASON_TONE = { good: "up", warn: "warn", bad: "down" } as const;

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: monthLabel(i + 1),
}));

const SELECT_CLASS = "h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-text";

function signedPct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

/** 比率の差をポイントで（0.006 → "+0.6pt"）。 */
function signedPt(diff: number): string {
  const v = Math.round(diff * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}pt`;
}

function pct(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

function manYen(yen: number | null): string {
  if (yen === null) return "—";
  return `${Math.round(yen / 1000) / 10}万円`;
}

function yen(v: number): string {
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

function posLabel(pos: number | null): string {
  if (pos === null) return "—";
  const p = Math.round(pos * 100);
  return pos >= 0.85 ? `高値圏 ${p}%` : pos <= 0.15 ? `安値圏 ${p}%` : `${p}%`;
}

type YearCell = YutaiStatsView["years"][number];

/** 過去 10 年の成績を、古い→新しい順の 10 枡にする（足りない古い側は空の枡）。 */
function yearCells(years: YearCell[]): (YearCell | null)[] {
  const recent = years.slice(-10);
  return [...Array<null>(10 - recent.length).fill(null), ...recent];
}

/** 月ごとの取得結果。"missing" は 404・形の崩れ・通信失敗（月を選び直すと取り直す）。 */
type MonthEntry = YutaiMonthFile | "missing";

/** 一覧の 1 行ぶん（順位付け済みの銘柄＋資金指定時のエントリー）。 */
interface Row {
  pick: YutaiPick;
  plan: YutaiEntryPlan | null;
  /** 決算またぎのとき、その発表予定日（YYYY-MM-DD）。またがなければ null */
  earnings: string | null;
  budgetYen: number | null;
  splitCount: number;
}

/**
 * ホームの「ピックアップ」→「優待」。株主優待の先回り買い候補の一覧。
 * 権利確定月ごとに、過去 10 年の「前月初の始値で買い、権利付最終日の終値で売る」成績（日足。無い銘柄は前月の月足）で
 * 総合評価・指標別の順位を付けて並べる（並べ方は lib/picks/yutai.ts）。
 * 資金と分散数を選ぶと、1 銘柄ぶんの推奨株数・エントリー金額・利確目安を出す（lib/yutai/entry.ts）。
 * データは月別の静的ファイル（/data/yutai/<M>.json）をブラウザが直接取る。取得済みの月は持ち回って再取得しない。
 * サーバー描画では「読み込み中…」を出し、マウント後に取得する（ハイドレーションを揃えるため）。
 * 行の詳細から保有中リストへ 1 タップで足せる（holdings・onAddHolding は HomeClient が一度だけ読んだ保有の状態）。
 * @param initialMonth 最初に開く権利確定月（1〜12）
 * @param todayIso 日本時間の今日
 */
export function YutaiPanel({
  initialMonth,
  todayIso,
  holdings = [],
  onAddHolding,
}: {
  initialMonth: number;
  todayIso: string;
  holdings?: Holding[];
  onAddHolding?: (h: Holding) => void;
}) {
  const startMonth = initialMonth >= 1 && initialMonth <= 12 ? initialMonth : 1;
  const [month, setMonth] = useState<number>(startMonth);
  const [cache, setCache] = useState<Record<number, MonthEntry>>({});
  const inflight = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (cache[month] !== undefined || inflight.current.has(month)) return;
    inflight.current.add(month);
    const target = month;
    fetch(yutaiMonthFileUrl(target))
      .then(async (res) => (res.ok ? parseYutaiMonthFile(await res.json()) : null))
      .catch(() => null)
      .then((file) => {
        inflight.current.delete(target);
        setCache((prev) => ({ ...prev, [target]: file ?? "missing" }));
      });
  }, [month, cache]);

  const entry = cache[month];
  const data = entry && entry !== "missing" ? entry : null;
  const asOf = data?.asOf ?? null;
  const loading = entry === undefined;

  const selectMonth = (m: number) => {
    // 取得できなかった月は、選び直したときに取り直す。
    if (cache[m] === "missing") {
      setCache((prev) => {
        const next = { ...prev };
        delete next[m];
        return next;
      });
    }
    setMonth(m);
  };

  // 優待に回す資金（万円）と分散数。ブラウザに覚えておく。以前の自由入力の値は一番近い選択肢に丸める。
  const [budgetText, setBudgetText] = useLocalStorage<string>("yutai.budgetMan", "");
  const budgetMan = normalizeBudgetMan(budgetText);
  const budgetYen = budgetMan === null ? null : budgetMan * 10_000;
  const [splitText, setSplitText] = useLocalStorage<string>("yutai.splitCount", String(YUTAI_DEFAULT_SPLIT));
  const splitCount = normalizeSplitCount(splitText);
  const [sortText, setSortText] = useLocalStorage<string>("yutai.sortKey", "score");
  const sortKey = parseYutaiSortKey(sortText);

  // 決算またぎを表示するか（既定は非表示）。廃止は常に除外。
  const [showEarnings, setShowEarnings] = useLocalStorage<boolean>("yutai.showEarnings", false);

  const ranked = useMemo(() => rankYutai(data), [data]);
  const exclusion = useMemo(
    () => applyYutaiExclusion(ranked, month, todayIso, showEarnings === true),
    [ranked, month, todayIso, showEarnings],
  );
  const rows = useMemo((): Row[] => {
    // 最低投資金額が分からない銘柄は、資金を指定していても残す。
    const candidates = exclusion.shown;
    const inBudget =
      budgetYen === null ? candidates : candidates.filter((p) => p.item.minInvest === null || p.item.minInvest <= budgetYen);
    const sorted = sortYutai(inBudget, sortKey).map(
      (pick): Row => ({
        pick,
        plan: budgetYen === null ? null : yutaiEntryPlan(pick.item.price, budgetYen, splitCount),
        earnings: earningsInWindow(pick.item, month, todayIso) ? (pick.item.nextEarningsDate ?? null) : null,
        budgetYen,
        splitCount,
      }),
    );
    // 1 銘柄の枠で 100 株も買えない銘柄は消さずに最後へ回す。
    return [...sorted.filter((r) => !r.plan?.overFrame), ...sorted.filter((r) => r.plan?.overFrame)];
  }, [exclusion, month, todayIso, budgetYen, sortKey, splitCount]);
  const unknownInvest = rows.filter((r) => r.pick.item.minInvest === null).length;

  const stale = asOf !== null && isYutaiStale(asOf, todayIso);
  const prev = prevMonthOf(month);
  const baseline = data?.baseline ?? null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-text">優待（先回り買い）</h2>

      <Segmented
        className="mt-2"
        options={MONTH_OPTIONS}
        value={String(month)}
        onChange={(v) => selectMonth(Number(v))}
      />
      <p className="mt-2 text-xs tabular-nums text-subtle">
        {monthLabel(month)}権利 → {monthLabel(prev)}初に買い、権利付最終日に売った過去 10 年の成績
        {ranked.length > 0 ? ` · 対象 ${ranked.length} 社` : ""}
        {asOf ? ` · 一覧は ${formatMonthDay(asOf)} 取得` : ""}
      </p>
      {ranked.length > 0 ? (
        <p className="mt-1 text-xs text-subtle">
          買いは {monthLabel(prev)}初 → 売りは {monthLabel(month)}の権利付最終日まで
        </p>
      ) : null}
      {stale && asOf ? (
        <p className="mt-1 text-xs text-warn">一覧が古い（{formatMonthDay(asOf)} 取得）</p>
      ) : null}

      {ranked.length > 0 ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              優待に回す資金
              <select
                value={budgetMan === null ? "" : String(budgetMan)}
                onChange={(e) => setBudgetText(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">指定なし</option>
                {YUTAI_BUDGET_OPTIONS_MAN.map((v) => (
                  <option key={v} value={String(v)}>
                    {v}万円
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              分散数
              <select value={String(splitCount)} onChange={(e) => setSplitText(e.target.value)} className={SELECT_CLASS}>
                {YUTAI_SPLIT_OPTIONS.map((v) => (
                  <option key={v} value={String(v)}>
                    {v}銘柄
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              並び順
              <select value={sortKey} onChange={(e) => setSortText(e.target.value)} className={SELECT_CLASS}>
                {YUTAI_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span className="tabular-nums">
              {showEarnings === true
                ? `廃止 ${exclusion.abolishedCount} 件を除外・決算またぎ ${exclusion.earningsCount} 件を表示中`
                : `決算またぎ ${exclusion.earningsCount} 件・廃止 ${exclusion.abolishedCount} 件を除外`}
            </span>
            <label className="flex min-h-8 items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={showEarnings === true}
                onChange={(e) => setShowEarnings(e.target.checked)}
              />
              決算またぎも表示
            </label>
          </div>
          {budgetYen !== null ? (
            <p className="mt-1 text-xs tabular-nums text-subtle">
              予算内 {rows.length - unknownInvest}社
              {unknownInvest > 0 ? `（最低投資額が不明 ${unknownInvest}社）` : ""} · 1銘柄の枠{" "}
              {manYen(budgetYen / splitCount)}
            </p>
          ) : null}
        </>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">読み込み中…</p>
      ) : ranked.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="更新待ち" description="夜間のデータ更新で作られます" />
        </div>
      ) : (
        <>
          {baseline ? <BaselineBand baseline={baseline} month={month} prevMonth={prev} /> : null}
          <PickList
            key={`${month}-${sortKey}-${budgetMan ?? ""}-${splitCount}`}
            rows={rows}
            baseline={baseline}
            excludedAll={ranked.length > 0 && exclusion.shown.length === 0}
            budgetSet={budgetYen !== null}
            month={month}
            todayIso={todayIso}
            holdings={holdings}
            onAddHolding={onAddHolding}
          />
        </>
      )}

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-muted">
        <p>
          勝ち＝前月初の始値で買い、権利付最終日の終値で売って利益が出た年。前月平均はその売買の騰落率の平均、最大上昇は期間中の高値までの上昇率の平均、+10%到達は期間中の高値が買値の
          +10% に届いた年の割合です（日足）。日足が取れない銘柄は前月の月足（月初→月末）で数え、「月足ベース」と表示します。
        </p>
        <p>
          過去の傾向で、将来の値動きを示すものではありません。2016〜25
          年の検証では前月の陽線数に予測力は確認できていません（3 月権利・9 月権利、CI が 0
          をまたぐ）。業績・IR と株価位置を併せて確認し、分散して使うのが前提です。
        </p>
        <p>
          総合＝成績が 5 年以上ある銘柄の中で、10 年の勝率・直近 5 年の勝率・前月平均・最大上昇の平均・+10%到達率のそれぞれの順位（上位ほど
          100）を平均した点数です。5 年未満の銘柄はデータ不足として最後に並べます。10 年・5
          年は今年を含まない暦年（買う月の年）です。地合い比＝その銘柄の前月平均と、同じ月の全銘柄の平均の差。
        </p>
        <p>
          除外＝優待が廃止された銘柄は常に外し、決算発表が買い開始日〜権利付最終日に入る銘柄（決算またぎ）は既定で外します。指値の候補＝成行のほか、過去の平均の下押し・75
          日線・直近 1 か月の安値まで下がるのを待つ買い方で、届いた年はその価格まで下がった年の割合です。
        </p>
        <p>
          推奨買付＝資金を分散数で割った 1 銘柄の枠で買える株数（100 株単位）と金額。株価は直近の終値で、枠で 100
          株買えない銘柄は「枠超え」として最後に薄く出します。利確目安は株価の +10%。
        </p>
        <p>
          出典:{" "}
          <a href={YUTAI_SOURCE.url} target="_blank" rel="noopener noreferrer" className="underline">
            {YUTAI_SOURCE.name}
          </a>
          ／株価: Yahoo Finance（分割・配当を補正）
        </p>
      </div>

      <details className="mt-3 border-t border-border">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-text marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block text-muted">▶</span>
            先回り買いとは
          </span>
        </summary>
        <YutaiGuide />
        <div className="mt-2 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-muted">
          <h3 className="text-sm font-medium text-text">売買のルール</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>買い: 前月の月初。</li>
            <li>売り: 権利付最終日（権利確定日の 2 営業日前）まで。</li>
            <li>目標は +10%。+8% まで上がったら +5% に逆指値を置いて利益を守る。</li>
            <li>決算発表をまたがない（直前の進捗がよければ例外）。</li>
            <li>1 銘柄に集中せず 4〜5 銘柄に分散する。</li>
            <li>株価位置が高値圏の銘柄・今期業績の悪い銘柄は避ける。</li>
          </ul>
        </div>
      </details>
    </section>
  );
}

/**
 * 月のベースライン（地合い）の帯。10 年平均と、年ごとの勝率・平均の枡。
 * 日足ベース（前月初→権利付最終日）があればそれを、無ければ前月の月足を出す。
 */
function BaselineBand({ baseline, month, prevMonth }: { baseline: YutaiBaseline; month: number; prevMonth: number }) {
  const r = baseline.rights ?? null;
  const years = r
    ? r.years.slice(-10).map((y) => ({ year: y.year, n: y.n, winRate: y.winRate, avgRet: y.avgRet }))
    : baseline.years.slice(-10).map((y) => ({ year: y.year, n: y.n, winRate: y.winRate, avgRet: y.avgRet }));
  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-3" aria-label="月の地合い">
      <p className="text-xs leading-relaxed text-text">
        {monthLabel(month)}権利の地合い（{r ? `${monthLabel(prevMonth)}初→権利付最終日` : `${monthLabel(prevMonth)}の月足`}）:{" "}
        {r ? (
          <span className="tabular-nums">
            全 {r.n} 社・10年平均で勝率 {pct(r.winRate10)}・平均 {r.avgRet10 === null ? "—" : signedPct(r.avgRet10)}
            ・+10%到達 {pct(r.hit10Rate10)}
          </span>
        ) : (
          <span className="tabular-nums">
            全 {baseline.n} 社・10年平均で勝率 {pct(baseline.winRate10)}・前月平均{" "}
            {baseline.avgRet10 === null ? "—" : signedPct(baseline.avgRet10)}・最大上昇{" "}
            {baseline.avgHighRet10 === null ? "—" : signedPct(baseline.avgHighRet10)}
          </span>
        )}
      </p>
      {years.length > 0 ? (
        <ol className="mt-2 grid grid-cols-5 gap-1 sm:grid-cols-10">
          {years.map((y) => (
            <li
              key={y.year}
              className="flex flex-col items-center rounded bg-surface px-0.5 py-1 tabular-nums"
              title={`${y.year}年 ${y.n}社 勝率 ${pct(y.winRate)} 平均 ${y.avgRet === null ? "—" : signedPct(y.avgRet)}`}
            >
              <span className="text-[10px] text-subtle">{y.year}</span>
              <span className="text-xs text-text">{pct(y.winRate)}</span>
              <span
                className={`text-[10px] ${y.avgRet === null ? "text-subtle" : y.avgRet > 0 ? "text-up" : y.avgRet < 0 ? "text-down" : "text-muted"}`}
              >
                {y.avgRet === null ? "—" : signedPct(y.avgRet)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

interface HoldingProps {
  month: number;
  todayIso: string;
  holdings: Holding[];
  onAddHolding?: (h: Holding) => void;
}

/** 順位付きの一覧。最初は 50 社、「さらに 50 社を見る」で増やす。 */
function PickList({
  rows,
  baseline,
  budgetSet,
  excludedAll,
  ...holdingProps
}: { rows: Row[]; baseline: YutaiBaseline | null; budgetSet: boolean; excludedAll: boolean } & HoldingProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        {excludedAll
          ? "決算またぎ・廃止を除くと表示できる銘柄がありません（「決算またぎも表示」で確認できます）"
          : "予算内の銘柄はありません"}
      </p>
    );
  }
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return (
    <>
      <ListHeader />
      <ol>
        {shown.map((row, i) => (
          <YutaiRow
            key={row.pick.item.code}
            rank={i + 1}
            row={row}
            baseline={baseline}
            budgetSet={budgetSet}
            {...holdingProps}
          />
        ))}
      </ol>
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-border text-sm text-text active:opacity-80"
        >
          さらに {Math.min(PAGE_SIZE, rest)} 社を見る（残り {rest} 社）
        </button>
      ) : null}
    </>
  );
}

function ListHeader() {
  return (
    <div className={`${ROW_GRID} mt-3 border-b border-border pb-2 text-xs text-muted`}>
      <span className="col-span-3">順位・銘柄（過去 10 年: 前月初→権利付最終日）</span>
      <span className="hidden lg:col-start-4 lg:grid lg:grid-cols-7 lg:gap-1">
        {METRIC_LABELS.map((label) => (
          <span key={label} className="text-right">
            {label}
          </span>
        ))}
      </span>
      <span className="col-start-4 text-right lg:col-start-5">総合</span>
    </div>
  );
}

/** 過去 10 年の成績の枡（緑=勝ち、赤=負け、枠色=データ無し）。古い→新しい順。+10% に届いた年は濃い縁取りを付ける。 */
function YearCells({ stats }: { stats: YutaiStatsView }) {
  const daily = stats.basis === "daily";
  return (
    <span
      className="flex gap-0.5"
      role="list"
      aria-label={daily ? "過去10年の前月初→権利付最終日の成績" : "過去10年の前月の月足"}
    >
      {yearCells(stats.years).map((c, i) => {
        if (!c) {
          return <span key={i} role="listitem" aria-label="データなし" className="h-2.5 w-2.5 rounded-sm bg-border" />;
        }
        const result = daily ? (c.win ? "勝ち" : "負け") : c.win ? "陽線" : "陰線";
        const hit = c.hit10 ? "・+10%到達" : "";
        return (
          <span
            key={i}
            role="listitem"
            title={`${c.year}年 ${signedPct(c.ret)}${hit}`}
            aria-label={`${c.year}年 ${result} ${signedPct(c.ret)}${hit}`}
            className={`h-2.5 w-2.5 rounded-sm ${c.win ? "bg-up" : "bg-down"} ${c.hit10 ? "ring-1 ring-text/60" : ""}`}
          />
        );
      })}
    </span>
  );
}

interface Metric {
  label: MetricLabel;
  value: string;
  sub?: string;
  /** 資金を指定していないスマホでは出さない（1280px では列を揃えるため「—」で出す） */
  budgetOnly?: boolean;
}

function YutaiRow({
  rank,
  row,
  baseline,
  budgetSet,
  month,
  todayIso,
  holdings,
  onAddHolding,
}: {
  rank: number;
  row: Row;
  baseline: YutaiBaseline | null;
  budgetSet: boolean;
} & HoldingProps) {
  const { pick, plan } = row;
  const { item, stats } = pick;
  const [open, setOpen] = useState(false);
  const detailId = `yutai-detail-${item.code}`;
  const lastYear = item.candles[item.candles.length - 1]?.year;
  // 地合い比は同じ計算元（日足どうし・月足どうし）で比べる
  const baseAvg = stats.basis === "daily" ? (baseline?.rights?.avgRet10 ?? null) : (baseline?.avgRet10 ?? null);
  const vsBase =
    stats.avgRet10 !== null && baseAvg !== null ? `地合い比 ${signedPt(stats.avgRet10 - baseAvg)}` : undefined;

  const metrics: Metric[] = [
    { label: "前月平均", value: stats.avgRet10 !== null ? signedPct(stats.avgRet10) : "—", sub: vsBase },
    { label: "最大上昇 平均", value: stats.avgHighRet10 !== null ? signedPct(stats.avgHighRet10) : "—" },
    { label: "+10%到達", value: pct(stats.hit10Rate) },
    {
      label: "株価位置",
      value: posLabel(pick.pricePos12),
      sub: item.priceAsOf ? `${formatMonthDay(item.priceAsOf)} 時点` : undefined,
    },
    { label: "最低投資", value: item.minInvest === null ? "投資額不明" : manYen(item.minInvest) },
    {
      label: "推奨買付",
      value: plan === null ? "—" : plan.overFrame ? "枠超え" : `${plan.shares}株`,
      sub: plan !== null && !plan.overFrame ? yen(plan.amountYen) : undefined,
      budgetOnly: true,
    },
    { label: "利確目安", value: plan === null ? "—" : yen(plan.takeProfitPrice), budgetOnly: true },
  ];

  return (
    <li className={`border-b border-border last:border-b-0 ${plan?.overFrame ? "opacity-50" : ""}`}>
      <div className={`${ROW_GRID} items-center py-3`}>
        <span
          className="col-start-1 row-start-1 text-center text-xs font-medium tabular-nums text-muted"
          aria-label={`順位 ${rank}`}
        >
          {rank}
        </span>
        <a
          href={`https://finance.yahoo.co.jp/quote/${item.code}.T`}
          target="_blank"
          rel="noopener noreferrer"
          className="col-start-2 row-start-1 flex h-10 w-11 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text active:opacity-80"
        >
          {item.code}
        </a>
        <span className="col-start-3 row-start-1 min-w-0">
          {item.detailUrl ? (
            <a
              href={item.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm text-text underline-offset-2 active:opacity-80"
            >
              {item.name}
            </a>
          ) : (
            <span className="block truncate text-sm text-text">{item.name}</span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <YearCells stats={stats} />
            {stats.basis === "monthly" ? (
              <span className="shrink-0 whitespace-nowrap text-[10px] text-subtle">月足ベース</span>
            ) : null}
            <a
              href={`https://kabutan.jp/stock/finance?code=${item.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 whitespace-nowrap text-[11px] text-accent underline-offset-2 active:opacity-80"
            >
              業績
            </a>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={detailId}
              className="shrink-0 whitespace-nowrap text-[11px] text-accent active:opacity-80"
            >
              詳細{open ? "▴" : "▾"}
            </button>
          </span>
          {pick.reasons.length > 0 || row.earnings ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {row.earnings ? <Chip tone="down">決算またぎ（{formatMonthDay(row.earnings)} 発表）</Chip> : null}
              {pick.reasons.map((r: YutaiReason) => (
                <span key={r.id} title={r.id === "changed" ? (item.yutaiNote ?? undefined) : undefined}>
                  <Chip tone={REASON_TONE[r.tone]}>{r.text}</Chip>
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="col-start-4 row-start-1 flex flex-col items-end lg:col-start-5">
          <span className="text-base font-medium leading-none tabular-nums text-text" aria-label="総合">
            {pick.score === null ? "—" : pick.score}
          </span>
          <span className="mt-1 whitespace-nowrap text-[11px] tabular-nums text-subtle">
            {pick.score === null ? "データ不足" : `10年 ${Math.round(pick.upRate10 * 100)}%`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={`${item.name}の詳細を${open ? "閉じる" : "開く"}`}
          className="col-span-4 col-start-1 row-start-2 mt-2 grid grid-cols-3 gap-x-1 gap-y-1.5 rounded-lg bg-surface-2 px-2 py-1.5 text-left lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:mt-0 lg:grid-cols-7 lg:bg-transparent lg:p-0"
        >
          {metrics.map((m) => (
            <span
              key={m.label}
              className={`min-w-0 flex-col lg:flex lg:items-end ${m.budgetOnly && !budgetSet ? "hidden" : "flex"}`}
            >
              <span className="text-[11px] text-muted lg:hidden">{m.label}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-text">{m.value}</span>
              {m.sub ? <span className="whitespace-nowrap text-[10px] tabular-nums text-subtle">{m.sub}</span> : null}
            </span>
          ))}
        </button>
        {open ? (
          <div
            id={detailId}
            className="col-span-4 col-start-1 row-start-3 mt-2 space-y-1 rounded-lg border border-border p-2 text-xs leading-relaxed text-muted lg:col-span-5"
          >
            <EntryDetail price={item.price} plan={plan} budgetSet={budgetSet} />
            <AddHoldingButton
              pick={pick}
              plan={plan}
              month={month}
              todayIso={todayIso}
              holdings={holdings}
              onAddHolding={onAddHolding}
            />
            <MaSplit item={item} />
            <LimitOrderSection item={item} stats={stats} budgetYen={row.budgetYen} splitCount={row.splitCount} />
            <p>
              前年 安値→高値: {pick.lastRange !== null ? signedPct(pick.lastRange) : "—"}
              {lastYear !== undefined ? `（${lastYear}年の月足。月内の最大幅で、実際に取れる幅ではありません）` : ""}
            </p>
            {item.high12 !== null && item.low12 !== null ? (
              <p className="tabular-nums">
                直近12ヶ月: 高値 {yen(item.high12)}・安値 {yen(item.low12)}
                {item.price !== null ? `・株価 ${yen(item.price)}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** 75 日線の上・下で買った年の勝ち数（古いデータで年数が無ければ出さない）。 */
function MaSplit({ item }: { item: YutaiPick["item"] }) {
  const r = item.rights;
  if (!r) return null;
  const above = r.nAbove10 ?? 0;
  const below = r.nBelow10 ?? 0;
  if (above + below === 0) return null;
  const f = (w: number | undefined, n: number) => (n > 0 ? `${w ?? 0}/${n}勝` : "—");
  return (
    <p className="tabular-nums">
      75日線の上で買った年 {f(r.winAbove10, above)}・下で買った年 {f(r.winBelow10, below)}
    </p>
  );
}

/** 指値の候補の表（既定は成行と押し目の 2 本、「もっと見る」で全部）と、自分の指値、期待利益・最悪ケース。 */
function LimitOrderSection({
  item,
  stats,
  budgetYen,
  splitCount,
}: {
  item: YutaiPick["item"];
  stats: YutaiStatsView;
  budgetYen: number | null;
  splitCount: number;
}) {
  const [more, setMore] = useState(false);
  const [text, setText] = useLocalStorage<string>(`ipo-analyzer:yutai-limit:${item.code}`, "");
  const plans = useMemo(() => limitOrderPlans(item, stats, budgetYen, splitCount), [item, stats, budgetYen, splitCount]);
  if (plans.length === 0) return null;
  const typed = text.trim() === "" ? NaN : Number(text);
  const custom = limitOrderPlan(item, "custom", "自分の指値", typed, budgetYen, splitCount);
  const listed = more ? plans : plans.slice(0, 2);
  const table = custom ? [...listed, custom] : listed;
  const basis = custom ?? plans[0];
  const outcome = basis.amountYen && basis.amountYen > 0 ? expectedOutcome(stats, basis.amountYen) : null;
  const signedYen = (v: number) => `${v < 0 ? "−" : "+"}${yen(Math.abs(v))}`;
  return (
    <div className="space-y-1" aria-label="指値の候補">
      <p className="font-medium text-text">指値の候補</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left tabular-nums">
          <thead className="text-[11px] text-subtle">
            <tr>
              <th className="py-0.5 pr-2 font-normal">候補</th>
              <th className="py-0.5 pr-2 text-right font-normal">指値</th>
              <th className="py-0.5 pr-2 text-right font-normal">株数・金額</th>
              <th className="py-0.5 pr-2 text-right font-normal">利確</th>
              <th className="py-0.5 pr-2 text-right font-normal">逆指値</th>
              <th className="py-0.5 text-right font-normal">届いた年</th>
            </tr>
          </thead>
          <tbody>
            {table.map((p: LimitOrderPlan) => (
              <tr key={p.id} className="border-t border-border align-top">
                <td className="py-1 pr-2 text-text">{p.label}</td>
                <td className="py-1 pr-2 text-right text-text">{yen(p.price)}</td>
                <td className="py-1 pr-2 text-right">
                  {p.shares === null ? "—" : p.shares === 0 ? "枠超え" : `${p.shares}株 ${yen(p.amountYen ?? 0)}`}
                </td>
                <td className="py-1 pr-2 text-right">{yen(p.takeProfitPrice)}</td>
                <td className="py-1 pr-2 text-right">
                  {yen(p.trailStopPrice)}
                  <span className="block text-[10px] text-subtle">{yen(p.trailTriggerPrice)} 到達後</span>
                </td>
                <td className="py-1 text-right">{p.fillRate === null ? "—" : pct(p.fillRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plans.length > 2 ? (
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="flex min-h-9 items-center text-[11px] text-accent active:opacity-80"
        >
          {more ? "閉じる" : "もっと見る"}
        </button>
      ) : null}
      <label className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        自分の指値
        <input
          type="number"
          inputMode="decimal"
          min={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="円"
          className="h-9 w-28 rounded-lg border border-border bg-surface-2 px-2 text-sm text-text"
        />
      </label>
      {outcome && (outcome.avgYen !== null || outcome.worstYen !== null) ? (
        <p className="tabular-nums">
          {basis.label}（{yen(basis.price)}・{yen(basis.amountYen ?? 0)}）で、過去 10 年の平均{" "}
          {outcome.avgYen === null ? "—" : signedYen(outcome.avgYen)}
          ・一番悪かった年{outcome.worstYear !== null ? `（${outcome.worstYear}年）` : ""}{" "}
          {outcome.worstYen === null ? "—" : signedYen(outcome.worstYen)}
        </p>
      ) : budgetYen === null ? (
        <p>資金を指定すると、期待利益と最悪ケースを円で出します。</p>
      ) : null}
      <p className="text-[11px] text-subtle">届いた年＝過去にその指値まで下がった年の割合（約定の保証ではありません）</p>
    </div>
  );
}

/** 詳細の中の売買の目安（利確・逆指値・資金指定時は株数と利益見込み）。 */
function EntryDetail({ price, plan, budgetSet }: { price: number | null; plan: YutaiEntryPlan | null; budgetSet: boolean }) {
  if (price === null) {
    return <p>株価が取れないため、売買の目安は出せません。</p>;
  }
  const tp = Math.round(price * (1 + YUTAI_TAKE_PROFIT));
  const trigger = Math.round(price * (1 + YUTAI_TRAIL_TRIGGER));
  const stop = Math.round(price * (1 + YUTAI_TRAIL_STOP));
  return (
    <>
      <p className="tabular-nums">
        利確目安 {yen(tp)}（+10%）・{yen(trigger)}（+8%）に達したら {yen(stop)}（+5%）に逆指値
      </p>
      {budgetSet && plan ? (
        plan.overFrame ? (
          <p className="tabular-nums">
            枠超え: 100 株 {yen(price * 100)} が 1 銘柄の枠 {yen(plan.frameYen)} を超えます
          </p>
        ) : (
          <p className="tabular-nums">
            1 銘柄の枠 {yen(plan.frameYen)} → {plan.shares} 株 {yen(plan.amountYen)}・+10% で利確したときの利益見込み +
            {yen(plan.profitYen)}
          </p>
        )
      ) : null}
    </>
  );
}

/**
 * 詳細の中の「保有に追加」。買値＝いまの株価、株数＝推奨株数（資金未指定・枠超えは 100 株）、戦略＝優待、
 * 権利確定月＝表示中の月、買付日＝今日。同じ銘柄・同じ月を保有中なら「保有中に追加済み」と出す。
 */
function AddHoldingButton({
  pick,
  plan,
  month,
  todayIso,
  holdings,
  onAddHolding,
}: { pick: YutaiPick; plan: YutaiEntryPlan | null } & HoldingProps) {
  const { item } = pick;
  if (!onAddHolding || item.price === null) return null;
  if (isHeldForYutai(holdings, item.code, month)) {
    return <p className="text-xs text-up">保有中に追加済み</p>;
  }
  const shares = plan !== null && !plan.overFrame ? plan.shares : null;
  const price = item.price;
  const add = () => {
    const h = holdingFromYutai({ id: newId(), code: item.code, name: item.name, price, shares, rightsMonth: month, todayIso });
    if (h) onAddHolding(h);
  };
  return (
    <button
      type="button"
      onClick={add}
      className="mt-1 flex min-h-11 w-full items-center justify-center rounded-lg border border-border text-sm text-text active:opacity-80"
    >
      保有に追加（{shares ?? 100}株・{yen(price)}・{monthLabel(month)}権利）
    </button>
  );
}
