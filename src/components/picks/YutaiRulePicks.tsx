"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { formatMonthDay } from "@/lib/hot/file";
import {
  isPicksStale,
  parsePicksFile,
  PICK_RULE_LABELS,
  YUTAI_PICKS_URL,
  type PickItem,
  type PickMonth,
  type PicksFile,
} from "@/lib/yutai/picksRules";

/** 末尾の固定注記。 */
export const YUTAI_RULE_PICKS_NOTE =
  "過去10年の同時期の成績で選んだ候補です。1銘柄あたりの勝率の上限は約77%、権利月ごとに上位10本を等金額で持った場合に80%台でした。母集団は今日優待がある銘柄で、途中で優待をやめた銘柄は含みません（生存バイアス）。売買推奨ではありません。";

function signedPct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

function manYen(yen: number): string {
  return `${Math.round(yen / 1000) / 10}万円`;
}

/** 取得の状態。undefined = 取得中、null = 無い・壊れている・通信失敗。 */
type Loaded = PicksFile | null | undefined;

/**
 * ホームの「ピックアップ」→「優待」の先頭に出す「検証ルールの候補」。
 * 夜間ジョブ（npm run yutai:picks）が作る /data/yutai/picks.json をブラウザから取って表示するだけ。
 * 手法: 権利付最終日の N 営業日前に買い、権利付最終日の大引けで売る（scripts/backtest/yutai/REPORT.md）。
 * 取得できない・古い（作成日が 7 日以上前）ときは「更新待ち」。
 * @param todayIso 日本時間の今日
 */
export function YutaiRulePicks({ todayIso }: { todayIso: string }) {
  const [file, setFile] = useState<Loaded>(undefined);

  useEffect(() => {
    let alive = true;
    fetch(YUTAI_PICKS_URL)
      .then(async (res) => (res.ok ? parsePicksFile(await res.json()) : null))
      .catch(() => null)
      .then((f) => {
        if (alive) setFile(f);
      });
    return () => {
      alive = false;
    };
  }, []);

  const stale = file ? isPicksStale(file.asOf, todayIso) : false;
  const ready = file !== undefined && file !== null && !stale;

  return (
    <section className="mb-4 rounded-xl border border-border bg-surface p-4" aria-label="検証ルールの候補">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-text">検証ルールの候補</h2>
        {file === undefined ? null : ready ? (
          <span className="text-xs tabular-nums text-subtle">{formatMonthDay(file.asOf)} 時点</span>
        ) : (
          <Chip tone="warn">更新待ち</Chip>
        )}
      </div>

      {file === undefined ? (
        <p className="py-6 text-center text-sm text-muted">読み込み中…</p>
      ) : !ready ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted">夜間のデータ更新で、検証済みのルールが選ぶ銘柄をここへ表示します</p>
          {file ? (
            <p className="mt-2 text-xs tabular-nums text-subtle">前回の作成: {formatMonthDay(file.asOf)}</p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-subtle">権利付最終日の数十営業日前に買い、権利付最終日の大引けで売る</p>
          <MarketLine file={file} />
          {file.months.length === 0 ? (
            <p className="mt-3 text-sm text-muted">いま対象の権利月はありません</p>
          ) : (
            file.months.map((m) => <MonthBlock key={m.month} month={m} todayIso={todayIso} />)
          )}
        </>
      )}

      <p className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">{YUTAI_RULE_PICKS_NOTE}</p>
    </section>
  );
}

function MarketLine({ file }: { file: PicksFile }) {
  return (
    <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text" aria-label="市場条件">
      直近1か月の優待銘柄中央値{" "}
      <span
        className={`tabular-nums ${file.marketRet1m === null ? "text-subtle" : file.marketRet1m > 0 ? "text-up" : file.marketRet1m < 0 ? "text-down" : "text-muted"}`}
      >
        {file.marketRet1m === null ? "—" : signedPct(file.marketRet1m)}
      </span>{" "}
      → 市場条件{" "}
      <span className={file.marketDown ? "font-medium text-up" : "font-medium text-muted"}>
        {file.marketDown ? "成立" : "不成立"}
      </span>
      <span className="block text-[11px] text-subtle">
        マイナスのときだけ B・C が成り立ちます（D は市場条件なし）
      </span>
    </p>
  );
}

function MonthBlock({ month, todayIso }: { month: PickMonth; todayIso: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium text-text">
        {month.month}月権利
        <span className="ml-1 text-xs font-normal tabular-nums text-subtle">
          （権利付最終日 {formatMonthDay(month.lastCumDate)}、今が約{month.entryDays}営業日前）
        </span>
      </h3>
      {month.items.length === 0 ? (
        <p className="mt-1 text-xs text-muted">ルールに当てはまる銘柄はありません</p>
      ) : (
        <>
          <ol className="mt-1">
            {month.items.map((item) => (
              <PickRow key={item.code} item={item} lastCumDate={month.lastCumDate} todayIso={todayIso} />
            ))}
          </ol>
          {month.matched > month.items.length ? (
            <p className="mt-1 text-[11px] tabular-nums text-subtle">
              該当 {month.matched} 社のうち上位 {month.items.length} 社
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function PickRow({ item, lastCumDate, todayIso }: { item: PickItem; lastCumDate: string; todayIso: string }) {
  const earningsInside =
    item.nextEarningsDate !== null && item.nextEarningsDate >= todayIso && item.nextEarningsDate <= lastCumDate;
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 border-b border-border py-3 last:border-b-0">
      <a
        href={`https://finance.yahoo.co.jp/quote/${item.code}.T`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-10 w-11 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text active:opacity-80"
      >
        {item.code}
      </a>
      <span className="min-w-0">
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
        <span className="mt-0.5 block text-xs tabular-nums text-muted">
          {item.win}/{item.n}勝・平均
          <span className={item.avg > 0 ? "text-up" : item.avg < 0 ? "text-down" : ""}>{signedPct(item.avg)}</span>
          ・最悪<span className={item.worst < 0 ? "text-down" : ""}>{signedPct(item.worst)}</span>
          {item.streak >= 2 ? `・${item.streak}連勝中` : ""}
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted">
          100株 {manYen(item.invest)}
          {item.minInvest !== null && item.minInvest > item.invest * 1.05 ? `（優待は ${manYen(item.minInvest)}〜）` : ""}
          {item.aboveMa75 === null ? "" : item.aboveMa75 ? "・75日線の上" : "・75日線の下"}
          {item.nextEarningsDate ? (
            <span className={earningsInside ? "text-warn" : ""}>
              ・決算 {formatMonthDay(item.nextEarningsDate)}
              {earningsInside ? "（期間中）" : ""}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {item.rules.map((r) => (
            <Chip key={r} tone={r === "B" ? "up" : r === "C" ? "accent" : "neutral"}>
              {r}: {PICK_RULE_LABELS[r]}
            </Chip>
          ))}
        </span>
      </span>
    </li>
  );
}
