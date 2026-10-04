"use client";

import { useEffect, useState } from "react";
import type { Ipo } from "@/types/ipo";
import type { ChecklistVerdict } from "@/lib/checklist/types";
import { buildChecklist } from "@/lib/checklist";
import { jstTodayIso } from "@/lib/date";

// 投資判断チェックリスト表示コンポーネント。
// 総合スコアには合算しない、参考情報としての表示専用。

const VERDICT_ORDER: ChecklistVerdict[] = ["pass", "warn", "fail", "unknown", "manual"];

const VERDICT_ICON: Record<ChecklistVerdict, string> = {
  pass: "✓",
  warn: "△",
  fail: "✗",
  unknown: "？",
  manual: "☐",
};

const VERDICT_CLASS: Record<ChecklistVerdict, string> = {
  pass: "text-up bg-up/15",
  warn: "text-warn bg-warn/15",
  fail: "text-down bg-down/15",
  unknown: "text-muted bg-surface-2",
  manual: "text-muted bg-surface-2",
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
    setTodayIso(jstTodayIso());
  }, []);

  if (todayIso === null) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-text">投資判断チェックリスト</h2>
        <p className="mt-2 text-xs text-muted">読み込み中…</p>
      </section>
    );
  }

  const result = buildChecklist(ipo, todayIso);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text">投資判断チェックリスト</h2>
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
      <p className="mt-4 text-[11px] leading-relaxed text-muted">
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
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${VERDICT_CLASS[v]}`}
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
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${VERDICT_CLASS[item.verdict]}`}
            title={VERDICT_LABEL[item.verdict]}
          >
            {VERDICT_ICON[item.verdict]}
          </span>
          <div>
            <span className="font-medium text-text">{item.label}</span>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {item.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );

  if (isCurrent) {
    return (
      <div className="rounded-2xl border-2 border-accent p-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-on-accent">
            現在のフェーズ
          </span>
          <span className="text-sm font-medium text-text">{label}</span>
        </div>
        {content}
      </div>
    );
  }

  return (
    <details className="group rounded-2xl border border-border p-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block text-muted transition-transform group-open:rotate-90">
            ▶
          </span>
          {label}
        </span>
      </summary>
      {content}
    </details>
  );
}
