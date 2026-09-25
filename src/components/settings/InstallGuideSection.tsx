import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";

/** アプリとして使う（ホーム画面追加）の手順セクション。 */
export function InstallGuideSection() {
  return (
    <Section title="アプリとして使う" note="ホーム画面に追加すると、ブラウザのアドレスバーなしで開けます。">
      <Card className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text">iPhone / iPad（Safari）</h3>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>下部の共有ボタン（□に↑のアイコン）をタップ</li>
            <li>「ホーム画面に追加」をタップ</li>
            <li>右上の「追加」をタップ</li>
          </ol>
        </div>
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-bold text-text">Android（Chrome）</h3>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>右上のメニュー（縦三点）をタップ</li>
            <li>「アプリをインストール」をタップ</li>
            <li>確認ダイアログで「インストール」をタップ</li>
          </ol>
        </div>
      </Card>
    </Section>
  );
}
