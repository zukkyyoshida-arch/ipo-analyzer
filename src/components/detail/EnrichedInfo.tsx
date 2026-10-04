import { Disclosure } from "@/components/ui/Disclosure";
import type { ReactNode } from "react";
import type { IpoEnriched } from "@/types/enriched";
import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";

const MISSING = "未取得";

/** 百万円の数値を桁区切りで。null は「—」。 */
function formatMillion(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  // サーバー（UTC）とブラウザでずれないよう日本時間に固定する（例: 2026/09/25 18:01）。
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** 折りたたみ1ブロック（summary はタップ領域44px以上）。 */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Disclosure className="border-b border-border last:border-b-0" summary={title}>
      <div className="pb-3">{children}</div>
    </Disclosure>
  );
}

/**
 * 96ut 由来の補完情報（会社概要・業績推移・大株主とロックアップ・出典）。
 * 未取得の項目は「未取得」と表示する。
 */
export function EnrichedInfo({ enriched }: { enriched?: IpoEnriched }) {
  if (!enriched) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">会社概要・業績・大株主の補完情報は{MISSING}です。</p>
      </Card>
    );
  }

  const profile = enriched.companyProfile;
  const history = enriched.financialHistory ?? [];
  const holders = enriched.majorShareholders ?? [];
  const lockup = enriched.lockup;
  const sourceEntries = Object.entries(enriched.sources).filter(
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] => !!entry[1],
  );
  const sourceUrls = Array.from(
    new Set([enriched.articleUrl, ...sourceEntries.map(([, s]) => s.url)]),
  ).filter((u) => u);

  return (
    <Card className="px-4">
      <Fold title="会社概要">
        {profile ? (
          <div>
            <ListRow label="所在地" value={profile.address ?? MISSING} />
            <ListRow label="設立" value={profile.established ?? MISSING} />
            <ListRow
              label="従業員数"
              value={
                profile.employeeCount === null
                  ? MISSING
                  : <span className="tabular-nums">{`${profile.employeeCount.toLocaleString("ja-JP")}人`}</span>
              }
            />
            <ListRow label="監査法人" value={profile.auditor ?? MISSING} />
          </div>
        ) : (
          <p className="text-sm text-muted">{MISSING}</p>
        )}
      </Fold>

      <Fold title="業績推移">
        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-xs tabular-nums">
              <thead>
                <tr className="text-muted">
                  <th className="py-1.5 text-left font-normal">期</th>
                  <th className="py-1.5 text-right font-normal">売上</th>
                  <th className="py-1.5 text-right font-normal">経常</th>
                  <th className="py-1.5 text-right font-normal">当期</th>
                  <th className="py-1.5 text-right font-normal">変化率</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.period} className="border-t border-border text-text">
                    <td className="py-1.5 pr-2 text-left">{p.period}</td>
                    <td className="py-1.5 text-right">{formatMillion(p.revenue)}</td>
                    <td className="py-1.5 text-right">{formatMillion(p.operatingProfit)}</td>
                    <td className="py-1.5 text-right">{formatMillion(p.netProfit)}</td>
                    <td className="py-1.5 text-right">{formatPercent(p.revenueChangePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">単位: 百万円（経常=経常利益、当期=当期純利益、変化率=売上高の前期比）</p>
          </div>
        ) : (
          <p className="text-sm text-muted">{MISSING}</p>
        )}
      </Fold>

      <Fold title="大株主とロックアップ">
        {lockup ? (
          <p className="mb-2 text-xs text-muted tabular-nums">
            ロックアップ {lockup.days > 0 ? `${lockup.days}日` : MISSING}
            {lockup.hasPriceRelease ? "（価格解除条項あり）" : ""}
            {lockup.coverage > 0 ? `・対象 ${lockup.coverage.toFixed(1)}%` : ""}
          </p>
        ) : null}
        {holders.length > 0 ? (
          <div>
            {holders.map((h) => (
              <ListRow
                key={h.name}
                label={h.name}
                value={
                  <span className="tabular-nums">
                    {`${h.ratioPercent.toFixed(1)}%`}
                    <span className="ml-1 text-xs text-muted">
                      {h.lockupDays === null ? "" : `LU ${h.lockupDays}日`}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">大株主: {MISSING}</p>
        )}
      </Fold>

      <Fold title="出典">
        <ul className="space-y-1">
          {sourceUrls.map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center break-all text-xs text-accent underline"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-muted">
          取得日時: {formatDateTime(enriched.fetchedAt)}
        </p>
      </Fold>
    </Card>
  );
}
