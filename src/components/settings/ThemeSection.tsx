"use client";

import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";

const THEME_OPTIONS: SegmentedOption<ThemeMode>[] = [
  { value: "auto", label: "自動" },
  { value: "dark", label: "ダーク" },
  { value: "light", label: "ライト" },
];

/** 表示テーマ設定セクション。自動／ダーク／ライトの Segmented。 */
export function ThemeSection() {
  const { mode, setTheme, hydrated } = useTheme();

  return (
    <Section title="表示テーマ" note="自動は端末の設定（ダーク/ライト）に従います。">
      <Card className="p-4">
        <Segmented
          options={THEME_OPTIONS}
          value={hydrated ? mode : "auto"}
          onChange={setTheme}
        />
      </Card>
    </Section>
  );
}
