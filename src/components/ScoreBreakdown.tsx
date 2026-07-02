import type { AxisScoreResult } from "@/lib/scoring/types";

// スコア内訳テーブル: 生データ → 点数 → 重み → 寄与ポイント → 根拠テキスト。
export function ScoreBreakdown({
  title,
  axis,
}: {
  title: string;
  axis: AxisScoreResult;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-2 font-medium">項目</th>
              <th className="px-2 py-2 font-medium">生データ</th>
              <th className="px-2 py-2 text-center font-medium">点数</th>
              <th className="px-2 py-2 text-center font-medium">重み</th>
              <th className="px-2 py-2 text-center font-medium">寄与</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {axis.items.map((item) => (
              <tr key={item.key} className="align-top">
                <td className="px-2 py-2 font-medium text-slate-700">
                  {item.label}
                  <p className="mt-0.5 font-normal text-slate-400">
                    {item.reason}
                  </p>
                </td>
                <td className="px-2 py-2 text-slate-600">{item.rawText}</td>
                <td className="px-2 py-2 text-center">
                  <PointChip points={item.points} />
                </td>
                <td className="px-2 py-2 text-center text-slate-600">
                  {item.weight}
                </td>
                <td
                  className={`px-2 py-2 text-center font-semibold ${
                    item.contribution > 0
                      ? "text-emerald-600"
                      : item.contribution < 0
                        ? "text-rose-600"
                        : "text-slate-400"
                  }`}
                >
                  {item.contribution > 0 ? "+" : ""}
                  {item.contribution}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-slate-600">
            <tr>
              <td colSpan={4} className="px-2 py-2 text-right font-medium">
                寄与合計（{axis.minTotal}〜{axis.maxTotal}）
              </td>
              <td className="px-2 py-2 text-center font-bold text-slate-800">
                {axis.rawTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PointChip({ points }: { points: number }) {
  const cls =
    points > 0
      ? "bg-emerald-50 text-emerald-700"
      : points < 0
        ? "bg-rose-50 text-rose-700"
        : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${cls}`}>
      {points > 0 ? "+" : ""}
      {points}
    </span>
  );
}
