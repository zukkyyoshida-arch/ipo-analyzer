"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/Section";
import { fetchQuote } from "@/lib/quote";
import { parseYutaiMonthFile } from "@/lib/yutai/file";
import { yutaiMonthFileUrl, type YutaiMonthFile } from "@/lib/yutai/types";
import {
  holdingStatus,
  lastCumInfo,
  pickPrice,
  realizedPnlOf,
  summarize,
  type HoldingStatus,
} from "@/lib/portfolio/judge";
import {
  HOLDING_STRATEGY_LABELS,
  PRICE_SOURCE_LABELS,
  isOpen,
  type Holding,
  type PriceCache,
  type PriceQuote,
} from "@/lib/portfolio/types";
import { stockLabel } from "@/lib/calendar/events";
import { HoldingSheet } from "./HoldingSheet";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/calendar/formParts";

/** 円の表示（¥1,234）。 */
export function yen(v: number): string {
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

/** 符号付きの円（+¥1,234 / −¥1,234）。 */
function signedYen(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}¥${Math.abs(r).toLocaleString("ja-JP")}`;
}

/** 符号付きの率（+1.2%）。 */
function signedPct(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
}

function tone(v: number): string {
  return v > 0 ? "text-up" : v < 0 ? "text-down" : "text-text";
}

/** 「10月1日」の表記。 */
function mdLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}

/** 状態の 1 行（色付き）。 */
function StatusLine({ status }: { status: HoldingStatus }) {
  if (status.kind === "unknown") {
    return <p className="text-xs text-muted">現在値がありません（「現在値を更新」か、編集から手入力）</p>;
  }
  const pct = status.pct ?? 0;
  if (status.kind === "takeProfit") {
    return (
      <p className="rounded-lg bg-up/15 px-2 py-1 text-sm font-bold text-up">
        +10% 到達 → 利確（{signedPct(pct)}）
      </p>
    );
  }
  if (status.kind === "trail") {
    return (
      <p className="rounded-lg bg-warn/15 px-2 py-1 text-sm font-bold text-warn">
        +8% 到達 → 逆指値を {yen(status.stopPrice)} に（{signedPct(pct)}）
      </p>
    );
  }
  return <p className={`text-sm ${tone(pct)}`}>監視中（{signedPct(pct)}）</p>;
}

/**
 * ホームの「保有中」タブ。買値を入れておくと、+8%（逆指値の引き上げ）と +10%（利確）への到達を機械的に出す。
 * 保有・現在値は端末の localStorage に保存する（holdings・prices と保存の関数は HomeClient が持つ）。
 * 現在値は「現在値を更新」で既存の /api/quote から取る（押したときだけ。自動で繰り返し取りに行かない）。
 * 優待の保有は、権利確定月の静的ファイル（/data/yutai/<M>.json）の月足終値も使う。どちらも無ければ手入力。
 */
export function PortfolioPanel({
  todayIso,
  holdings,
  prices,
  hydrated,
  onSave,
  onRemove,
  onPrices,
}: {
  todayIso: string;
  holdings: Holding[];
  prices: PriceCache;
  hydrated: boolean;
  onSave: (h: Holding) => void;
  onRemove: (id: string) => void;
  onPrices: (quotes: Record<string, PriceQuote>) => void;
}) {
  const [editing, setEditing] = useState<Holding | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [showSold, setShowSold] = useState(false);

  const open = useMemo(() => holdings.filter(isOpen), [holdings]);
  const sold = useMemo(
    () => holdings.filter((h) => !isOpen(h)).sort((a, b) => (b.sold?.date ?? "").localeCompare(a.sold?.date ?? "")),
    [holdings],
  );
  const summary = useMemo(() => summarize(holdings, prices), [holdings, prices]);

  // 優待の保有は、権利確定月の静的ファイルの月足終値を下支えに使う（静的ファイルなので Worker の処理は増えない）。
  const yutaiMonths = useMemo(
    () =>
      [...new Set(open.filter((h) => h.strategy === "yutai" && h.rightsMonth !== null).map((h) => h.rightsMonth as number))].sort(
        (a, b) => a - b,
      ),
    [open],
  );
  const [yutaiFiles, setYutaiFiles] = useState<Record<number, YutaiMonthFile | "missing">>({});
  const inflight = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const m of yutaiMonths) {
      if (yutaiFiles[m] !== undefined || inflight.current.has(m)) continue;
      inflight.current.add(m);
      fetch(yutaiMonthFileUrl(m))
        .then(async (res) => (res.ok ? parseYutaiMonthFile(await res.json()) : null))
        .catch(() => null)
        .then((file) => {
          inflight.current.delete(m);
          setYutaiFiles((prev) => ({ ...prev, [m]: file ?? "missing" }));
        });
    }
  }, [yutaiMonths, yutaiFiles]);
  // 取れた月足終値を、まだ無い・古い銘柄にだけ入れる（新しい値は上書きしない）。
  useEffect(() => {
    const quotes: Record<string, PriceQuote> = {};
    for (const h of open) {
      if (h.rightsMonth === null) continue;
      const file = yutaiFiles[h.rightsMonth];
      if (!file || file === "missing") continue;
      const item = file.items.find((it) => it.code === h.code);
      const cur = prices[h.code];
      if (item?.price && (!cur || cur.asOf < file.asOf)) {
        quotes[h.code] = { price: item.price, asOf: file.asOf, source: "yutai" };
      }
    }
    if (Object.keys(quotes).length > 0) onPrices(quotes);
  }, [open, yutaiFiles, prices, onPrices]);

  const refresh = async () => {
    setLoading(true);
    setFailed([]);
    const quotes: Record<string, PriceQuote> = {};
    const ng: string[] = [];
    // 1 件ずつ順に取る（同時に大量に投げない）。
    for (const code of [...new Set(open.map((h) => h.code))]) {
      const q = await fetchQuote(code, undefined, 7);
      const last = q?.closes[q.closes.length - 1];
      if (q && typeof q.price === "number" && Number.isFinite(q.price) && q.price > 0) {
        quotes[code] = { price: q.price, asOf: last?.date ?? todayIso, source: "live" };
      } else ng.push(code);
    }
    onPrices(quotes);
    setFailed(ng);
    setLoading(false);
  };

  return (
    <div>
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[11px] text-muted">投資額</p>
            <p className="text-sm font-medium tabular-nums text-text">{yen(summary.invested)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">評価額</p>
            <p className="text-sm font-medium tabular-nums text-text">{yen(summary.value)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted">評価損益</p>
            <p className={`text-sm font-medium tabular-nums ${tone(summary.pnl)}`}>
              {signedYen(summary.pnl)}
              {summary.pnlPct !== null ? <span className="ml-1 text-[11px]">{signedPct(summary.pnlPct)}</span> : null}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-subtle">
          保有中 {summary.openCount} 件
          {summary.unpricedCount > 0 ? ` · 現在値が無い ${summary.unpricedCount} 件は買値で計算` : ""}
          {sold.length > 0 ? ` · 確定損益 ${signedYen(summary.realizedPnl)}` : ""}
        </p>
      </Card>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setEditing("new")} className={PRIMARY_BUTTON_CLASS}>
          ＋ 保有を追加
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || open.length === 0}
          className={`${SECONDARY_BUTTON_CLASS} disabled:opacity-40`}
        >
          {loading ? "取得中…" : "現在値を更新"}
        </button>
      </div>
      {failed.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-warn">
          {failed.join("・")} の現在値を取れませんでした。編集から手入力できます
        </p>
      ) : null}

      <Section
        title="保有中"
        note="+8% で逆指値を買値+5% に引き上げ、+10% で利確（ルール固定）"
        className="mt-5"
      >
        {!hydrated ? (
          <p className="py-6 text-center text-xs text-muted">読み込み中…</p>
        ) : open.length === 0 ? (
          <EmptyState
            title="保有中の銘柄はありません"
            description="「保有を追加」で買値と株数を入れると、+8% と +10% への到達を表示します"
          />
        ) : (
          <ul className="space-y-2">
            {open.map((h) => (
              <li key={h.id}>
                <HoldingRow holding={h} price={pickPrice(h, prices)} todayIso={todayIso} onEdit={() => setEditing(h)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {sold.length > 0 ? (
        <Section
          title="売却済み"
          action={
            <button type="button" onClick={() => setShowSold((v) => !v)} className="min-h-11 text-xs text-accent">
              {showSold ? "閉じる" : `${sold.length} 件を表示`}
            </button>
          }
        >
          {showSold ? (
            <ul className="space-y-2">
              {sold.map((h) => {
                const pnl = realizedPnlOf(h) ?? 0;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(h)}
                      className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left active:opacity-80"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">{stockLabel(h.code, h.name)}</span>
                        <span className="block text-[11px] tabular-nums text-muted">
                          {yen(h.buyPrice)} → {yen(h.sold?.price ?? 0)} × {h.shares.toLocaleString("ja-JP")}株 ·{" "}
                          {h.sold ? mdLabel(h.sold.date) : ""}売却
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm font-medium tabular-nums ${tone(pnl)}`}>
                        {signedYen(pnl)}
                        <span className="block text-right text-[11px]">
                          {signedPct(((h.sold?.price ?? h.buyPrice) / h.buyPrice - 1) * 100)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Section>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        保有はこの端末だけに保存されます。現在値は取得時点・手入力・優待データの月足終値のうち日付の新しい値を使い、
        いつ時点の値かを各行に出します。売買の判断はご自身で行ってください。
      </p>

      {editing !== null ? (
        <HoldingSheet
          key={editing === "new" ? "new" : editing.id}
          holding={editing === "new" ? null : editing}
          todayIso={todayIso}
          onClose={() => setEditing(null)}
          onSave={(h) => {
            onSave(h);
            setEditing(null);
          }}
          onRemove={(id) => {
            onRemove(id);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function HoldingRow({
  holding: h,
  price,
  todayIso,
  onEdit,
}: {
  holding: Holding;
  price: PriceQuote | null;
  todayIso: string;
  onEdit: () => void;
}) {
  const status = holdingStatus(h.buyPrice, price?.price ?? null);
  const cum = lastCumInfo(h, todayIso);
  return (
    <button
      type="button"
      onClick={onEdit}
      className="block w-full rounded-xl border border-border bg-surface p-3 text-left active:opacity-80"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{stockLabel(h.code, h.name)}</span>
        <Chip tone={h.strategy === "yutai" ? "accent" : "neutral"}>
          {HOLDING_STRATEGY_LABELS[h.strategy]}
          {h.strategy === "yutai" && h.rightsMonth !== null ? ` ${h.rightsMonth}月` : ""}
        </Chip>
      </div>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted">
        買値 {yen(h.buyPrice)} × {h.shares.toLocaleString("ja-JP")}株
        {price ? (
          <>
            {" "}
            · 現在値 {yen(price.price)}（{mdLabel(price.asOf)}時点・{PRICE_SOURCE_LABELS[price.source]}）
          </>
        ) : null}
      </p>
      <div className="mt-1.5">
        <StatusLine status={status} />
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-subtle">
        引き上げ {yen(status.triggerPrice)} → 逆指値 {yen(status.stopPrice)} · 利確 {yen(status.targetPrice)}
      </p>
      {cum ? (
        <p className={`mt-0.5 text-[11px] ${cum.days <= 3 ? "font-medium text-warn" : "text-muted"}`}>
          権利付最終日 {mdLabel(cum.date)}まで{cum.days === 0 ? "（今日）" : `あと ${cum.days} 日`}
        </p>
      ) : null}
      {h.memo ? <p className="mt-0.5 truncate text-[11px] text-muted">{h.memo}</p> : null}
    </button>
  );
}
