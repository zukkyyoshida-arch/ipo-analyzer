// 全ページ共通の免責フッター。コンプライアンス上、必須。
export function Disclaimer() {
  return (
    <footer className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted">
      <p>
        本アプリは公開情報をユーザー設定ルールで機械的に整理する個人用ツールです。投資助言を目的とせず、特定銘柄の売買の可否を示すものではありません。投資判断はご自身の責任で行ってください。公開情報を機械的に取得したもので正確性・完全性を保証しません。
      </p>
    </footer>
  );
}

// スコア表示付近に置く注記。
export function ScoreNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      スコアは設定した重みに基づく機械的な集計値です。
    </p>
  );
}
