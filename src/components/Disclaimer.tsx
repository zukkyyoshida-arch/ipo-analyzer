// 全ページ共通の免責フッター。コンプライアンス上、必須。
export function Disclaimer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white px-4 py-6 text-xs leading-relaxed text-slate-500">
      <div className="mx-auto max-w-3xl">
        <p>
          本アプリは公開情報をユーザー設定ルールで機械的に整理する個人用ツールです。投資助言・売買推奨を行うものではありません。投資判断はご自身の責任で行ってください。データはサンプルであり正確性・完全性を保証しません。
        </p>
      </div>
    </footer>
  );
}

// スコア表示付近に置く注記。
export function ScoreNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      スコアは設定した重みに基づく機械的な集計値です。
    </p>
  );
}
