// 事業内容テキストからテーマタグを自動付与する純関数。テスト対象。
//
// 既存のテーマ語彙（AI/SaaS/半導体/セキュリティ/D2C/人材/インフラ/不人気/その他）に対し、
// キーワードのマッチでタグを推定する。手動設定済みタグは呼び出し側で維持し、ここでは
// 「テキストから見つかったタグ」だけを返す。判定は保守的（明確な語のみ）。

/** テーマタグごとのキーワード辞書。小文字化して部分一致で判定する。 */
const THEME_KEYWORDS: Record<string, string[]> = {
  AI: [
    "ai",
    "人工知能",
    "機械学習",
    "ディープラーニング",
    "深層学習",
    "生成ai",
    "llm",
    "推論",
  ],
  半導体: ["半導体", "semiconductor", "チップ", "wafer", "ウェハ", "集積回路"],
  セキュリティ: [
    "セキュリティ",
    "security",
    "ゼロトラスト",
    "サイバー",
    "cyber",
    "暗号",
    "認証基盤",
    "soc",
  ],
  SaaS: [
    "saas",
    "サブスク",
    "subscription",
    "クラウドサービス",
    "業務システム",
    "プラットフォーム",
    "dx",
  ],
  D2C: ["d2c", "ec", "eコマース", "通販", "ブランド", "リカバリーウェア"],
  人材: [
    "人材",
    "採用",
    "求人",
    "hr",
    "フリーランス",
    "副業",
    "マッチング",
    "業務委託",
  ],
  インフラ: [
    "インフラ",
    "電力",
    "エネルギー",
    "再エネ",
    "再生可能エネルギー",
    "通信網",
    "物流",
    "電気",
    "ガス",
  ],
};

/** 事業内容テキスト等からテーマタグ候補を推定する。マッチ順（辞書の定義順）で返す。 */
export function inferThemes(text: string): string[] {
  const hay = text.toLowerCase();
  const found: string[] = [];
  for (const [tag, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((kw) => hay.includes(kw.toLowerCase()))) {
      found.push(tag);
    }
  }
  return found;
}

/**
 * 既存タグに自動推定タグをマージする。
 * - 手動タグ（existing）は常に維持し、上書きしない。
 * - 自動推定タグのうち existing に無いものだけ追加する。
 * - 何もマッチせず existing も空なら ["その他"] を返す。
 */
export function mergeThemes(existing: string[], text: string): string[] {
  const inferred = inferThemes(text);
  const set = new Set(existing.filter((t) => t.length > 0));
  for (const tag of inferred) set.add(tag);
  const result = Array.from(set);
  if (result.length === 0) return ["その他"];
  return result;
}
