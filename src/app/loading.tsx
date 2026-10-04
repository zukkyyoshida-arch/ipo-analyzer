export default function Loading() {
  return (
    <div className="space-y-3" role="status" aria-label="読み込み中">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-border bg-surface p-4"
        >
          <div className="h-4 w-1/3 rounded bg-surface-2" />
          <div className="mt-3 h-3 w-full rounded bg-surface-2" />
          <div className="mt-2 h-3 w-2/3 rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
