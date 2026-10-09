import Link from "next/link";
import type { ReactNode } from "react";

// YouTube API 監査用ページ共通の外枠（ヘッダー＋フッター）。静的サーバーコンポーネント。
export const APP_NAME = "IPO Secondary Uploader";
export const OWNER_JA = "吉田 和輝";
export const OWNER_EN = "Kazuki Yoshida";
export const CONTACT_EMAIL = "kazukiyyyy0926@gmail.com";

const NAV = [
  { href: "/youtube-uploader", label: "Home" },
  { href: "/youtube-uploader/privacy", label: "Privacy" },
  { href: "/youtube-uploader/terms", label: "Terms" },
] as const;

export function DocShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-10 pt-4 text-[15px] leading-7">
      <header className="mb-6 border-b border-border pb-3">
        <Link
          href="/youtube-uploader"
          className="text-sm font-medium text-accent"
        >
          {APP_NAME}
        </Link>
      </header>
      {children}
      <footer className="mt-10 border-t border-border pt-4 text-sm text-muted">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-accent underline">
              {n.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2">
          {APP_NAME} / {OWNER_JA}（{OWNER_EN}）
        </p>
      </footer>
    </div>
  );
}

export function H1({ ja, en }: { ja: string; en: string }) {
  return (
    <h1 className="text-2xl font-medium leading-snug [text-wrap:balance]">
      {ja}
      <span className="mt-1 block text-base font-normal text-muted">{en}</span>
    </h1>
  );
}

export function Section({
  ja,
  en,
  children,
}: {
  ja: string;
  en: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium leading-snug [text-wrap:balance]">
        {ja}
        <span className="block text-sm font-normal text-muted">{en}</span>
      </h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline"
    >
      {children}
    </a>
  );
}

export function En({ children }: { children: ReactNode }) {
  return <p className="text-muted">{children}</p>;
}
