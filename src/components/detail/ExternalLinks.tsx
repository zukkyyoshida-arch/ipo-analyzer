import { buildExternalLinks } from "@/lib/links";
import { Card } from "@/components/ui/Card";

/**
 * 一次情報リンク（株探・JPX・EDINET・96ut 記事）。外部サイトを新しいタブで開く。
 * 行全体をタップ領域にするため、ListRow と同じ見た目の <a> で並べる。
 * @param code 証券コード
 * @param articleUrl 96ut 記事 URL（enriched.articleUrl。任意）
 */
export function ExternalLinks({ code, articleUrl }: { code: string; articleUrl?: string }) {
  const links = buildExternalLinks(code, articleUrl);
  return (
    <Card className="px-4 py-1">
      {links.map((link) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 active:opacity-80"
        >
          <span className="min-w-0">
            <span className="block text-sm text-text">{link.label}</span>
            <span className="block text-[11px] text-muted">{link.note}</span>
          </span>
          <span className="shrink-0 text-xs text-accent-2" aria-hidden="true">
            開く ↗
          </span>
        </a>
      ))}
    </Card>
  );
}
