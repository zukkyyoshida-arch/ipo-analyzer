"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface TabDef {
  href: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  isActive: (pathname: string) => boolean;
}

function HomeIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
      <path
        d="M4 11.5L12 4l8 7.5"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 10v9h12v-9"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
      <rect
        x="4"
        y="4.5"
        width="16"
        height="4.5"
        rx="1.2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <rect
        x="4"
        y="10.5"
        width="16"
        height="4.5"
        rx="1.2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <rect
        x="4"
        y="16.5"
        width="16"
        height="4"
        rx="1.2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
    </svg>
  );
}

function FilterIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClipboardIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
      <rect
        x="5"
        y="5"
        width="14"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path
        d="M9 4.5h6a1 1 0 011 1V7H8V5.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path
        d="M8.5 12h7M8.5 15.5h7"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearIcon(active: boolean) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
      <circle
        cx="12"
        cy="12"
        r="3.2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path
        d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M6.3 17.7l1.6-1.6M16.1 7.9l1.6-1.6"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

const TABS: TabDef[] = [
  {
    href: "/",
    label: "ホーム",
    icon: HomeIcon,
    isActive: (p) => p === "/",
  },
  {
    href: "/ipos",
    label: "銘柄",
    icon: ListIcon,
    isActive: (p) => p === "/ipos" || p.startsWith("/ipo/"),
  },
  {
    href: "/screener",
    label: "スクリーナー",
    icon: FilterIcon,
    isActive: (p) => p.startsWith("/screener"),
  },
  {
    href: "/bb",
    label: "BB",
    icon: ClipboardIcon,
    isActive: (p) => p.startsWith("/bb"),
  },
  {
    href: "/settings",
    label: "設定",
    icon: GearIcon,
    isActive: (p) => p.startsWith("/settings"),
  },
];

/**
 * 画面下部固定のタブバー。ホーム／銘柄／スクリーナー／BB／設定の5タブ。
 * `/ipo/*` では「銘柄」タブをアクティブ表示する。
 */
export function BottomTabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="メインナビゲーション"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg pb-safe"
    >
      <div className="mx-auto flex w-full max-w-lg items-stretch justify-between px-1">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center py-1.5 text-[11px] font-medium active:opacity-80 ${
                active ? "text-text" : "text-muted"
              }`}
            >
              <span
                className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 ${active ? "bg-accent/15" : ""}`}
              >
                {tab.icon(active)}
                <span>{tab.label}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
