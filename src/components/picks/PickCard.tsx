import type { ReactNode } from "react";
import Link from "next/link";
import { Disclosure } from "@/components/ui/Disclosure";
import { PICK_VERDICT_LABELS, type PickVerdict } from "@/lib/picks/verdict";

/** 結論バッジの色（参加候補=緑・様子見=灰・見送り=赤）。 */
const VERDICT_CLASS: Record<PickVerdict, string> = {
  go: "border-up text-up",
  watch: "border-border text-muted",
  skip: "border-ng text-ng",
};

/** 結論バッジ1個。 */
export function VerdictBadge({ verdict }: { verdict: PickVerdict }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${VERDICT_CLASS[verdict]}`}
    >
      {PICK_VERDICT_LABELS[verdict]}
    </span>
  );
}

/**
 * ピックアップの「1カード1結論」。3層で組む:
 * ① 見出し行（順位・コード・社名・ステータス）＋ 結論バッジ ② 根拠の1行 ③ 指標・チップは Disclosure に畳む（既定は閉じる）。
 * 見出し行は銘柄詳細へのリンク。
 * @param rank 順位（出さないときは省く）
 * @param status 「受付中 10/21まで」などの受付状況
 * @param summary 根拠の1行（数字には必ずラベルを付ける。例「BB 48 ・ 公募割れ 41% ・ ✗3」）
 * @param details 展開したときの中身（チップ・指標の表など）
 * @param detailsLabel 展開の見出し
 */
export function PickCard({
  href,
  code,
  name,
  rank,
  status,
  verdict,
  summary,
  details,
  detailsLabel = "根拠と指標",
}: {
  href: string;
  code: string;
  name: string;
  rank?: number;
  status: ReactNode;
  verdict: PickVerdict;
  summary: string;
  details: ReactNode;
  detailsLabel?: string;
}) {
  return (
    <li className="rounded-2xl border border-border bg-surface px-4 pt-3">
      <Link
        href={href}
        // 銘柄リンクは画面内に並ぶ数が多いので先読みしない（タップ時に取得する）。
        prefetch={false}
        className="flex items-center gap-3 active:opacity-80"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xs font-medium tabular-nums text-text">
          {code}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            {rank !== undefined ? <span className="shrink-0 text-xs tabular-nums text-subtle">{rank}.</span> : null}
            <span className="truncate text-sm text-text">{name}</span>
          </span>
          <span className="block">{status}</span>
        </span>
        <VerdictBadge verdict={verdict} />
      </Link>
      <p className="mt-2 text-xs tabular-nums text-text">{summary}</p>
      <Disclosure muted summary={detailsLabel} className="mt-1">
        <div className="pb-3">{details}</div>
      </Disclosure>
    </li>
  );
}
