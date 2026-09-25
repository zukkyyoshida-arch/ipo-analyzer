import type { Ipo } from "@/types/ipo";
import { Card } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";

interface TimelineStep {
  label: string;
  value: string;
}

function formatRange(start: string, end: string): string {
  if (start === "" && end === "") return "未取得";
  if (start === "" || end === "") return "未取得";
  return `${formatDate(start)}〜${formatDate(end)}`;
}

function formatSingle(iso: string): string {
  if (iso === "") return "未取得";
  return formatDate(iso);
}

/**
 * 日程タイムライン。BB期間→抽選日→購入期間→上場日。空の項目は「未取得」。
 */
export function Timeline({ ipo }: { ipo: Ipo }) {
  const steps: TimelineStep[] = [
    { label: "BB期間", value: formatRange(ipo.bbPeriod.start, ipo.bbPeriod.end) },
    { label: "抽選日", value: formatSingle(ipo.allotmentDate) },
    {
      label: "購入期間",
      value: formatRange(ipo.purchasePeriod.start, ipo.purchasePeriod.end),
    },
    { label: "上場日", value: formatSingle(ipo.listingDate) },
  ];

  return (
    <Card className="p-4">
      <ol className="space-y-0">
        {steps.map((step, i) => (
          <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
              {i < steps.length - 1 ? (
                <span className="mt-1 w-px flex-1 bg-border" />
              ) : null}
            </div>
            <div className="min-w-0 pb-1">
              <p className="text-xs text-muted">{step.label}</p>
              <p
                className={`mt-0.5 text-sm font-medium ${
                  step.value === "未取得" ? "text-muted" : "text-text"
                }`}
              >
                {step.value}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
