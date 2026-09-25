"use client";

import { useEffect, useState } from "react";
import type { Ipo } from "@/types/ipo";
import type { ChecklistVerdict } from "@/lib/checklist/types";
import { buildChecklist } from "@/lib/checklist";

// 投資判断チェックリスト表示コンポーネント。
// 総合スコアには合算しない、参考情報としての表示専用。

/** 実行環境のローカル日付（JST想定）を YYYY-MM-DD で返す。 */
function todayIsoJst(): string {
  const now = new Date();
  // JST (UTC+9) に固定したいが、ユーザー環境が既にJSTである個人用ツールのため
  // ローカル日時をそのまま YYYY-MM-DD 化する。
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const VERDICT_ORDER: ChecklistVerdict[] = ["pass", "warn", "fail", "unknown", "manual"];

const VERDICT_ICON: Record<ChecklistVerdict, string> = {
  pass: "✓",
  warn: "△",
  fail: "✗",
  unknown: "？",
  manual: "☐",
};

const VERDICT_CLASS: Record<ChecklistVerdict, string> = {
  pass: "text-emerald-600 bg-emerald-50",
  warn: "text-amber-600 bg-amber-50",
  fail: "text-rose-600 bg-rose-50",
  unknown: "text-slate-400 bg-slate-100",
  manual: "text-slate-500 bg-slate-100",
};

const VERDICT_LABEL: Record<ChecklistVerdict, string> = {
  pass: "クリア",
  warn: "注意",
  fail: "警戒",
  unknown: "判定不能",
  manual: "要確認",
};

export function InvestmentChecklist({ ipo }: { ipo: Ipo }) {
  // hydration mismatch を避けるため、初期表示はサーバーと同じ空状態にし、
  // マウント後に today を確定させて再計算する。
  const [todayIso, setTodayIso] = useState<string | null>(null);

  // マウント後に一度だけ日付を確定させる。SSR とのハイドレーション不整合を避けるため、
  // 初回レンダリングでは null のままにし、ここでの setState は意図的（useLocalStorage と同様の作法）。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayIso(todayIsoJst());
  }, []);

  if (todayIso === null) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-800">投資判断チェックリスト</h2>
        <p className="mt-2 text-xs text-slate-400">読み込み中…</p>
      </section>
    );
  }

  const result = buildChecklist(ipo, todayIso);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">投資判断チェックリスト</h2>
        <CountsSummary counts={result.counts} />
      </div>
      <div className="space-y-3">
        {result.sections.map((section) => (
          <ChecklistSectionView
            key={section.phase}
            label={section.label}
            items={section.items}
            isCurrent={section.phase === result.phase}
          />
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        本チェックリストは公開情報をルールで機械的に照合した参考情報であり、総合スコアには合算されません。投資助言ではありません。投資判断はご自身の責任で行ってください。
      </p>
    </section>
  );
}

function CountsSummary({
  counts,
}: {
  counts: Record<ChecklistVerdict, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {VERDICT_ORDER.map((v) => (
        <span
          key={v}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${VERDICT_CLASS[v]}`}
        >
          {VERDICT_ICON[v]}
          {counts[v]}
        </span>
      ))}
    </div>
  );
}

function ChecklistSectionView({
  label,
  items,
  isCurrent,
}: {
  label: string;
  items: { id: string; label: string; verdict: ChecklistVerdict; detail: string }[];
  isCurrent: boolean;
}) {
  const content = (
    <ul className="space-y-1.5 pt-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 text-sm">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${VERDICT_CLASS[item.verdict]}`}
            title={VERDICT_LABEL[item.verdict]}
          >
            {VERDICT_ICON[item.verdict]}
          </span>
          <div>
            <span className="font-medium text-slate-700">{item.label}</span>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {item.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );

  if (isCurrent) {
    return (
      <div className="rounded-lg border-2 border-slate-800 p-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            現在のフェーズ
          </span>
          <span className="text-sm font-bold text-slate-800">{label}</span>
        </div>
        {content}
      </div>
    );
  }

  return (
    <details className="group rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-600 marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block text-slate-400 transition-transform group-open:rotate-90">
            ▶
          </span>
          {label}
        </span>
      </summary>
      {content}
    </details>
  );
}
