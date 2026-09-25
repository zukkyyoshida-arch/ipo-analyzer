# Apollo IPO Phase 2 設計書（確定版 / 2026-09-25）

実装エージェントはこの文書「だけ」読めば実装できる粒度で書く。3つのレンズ案（投資家フロー優先
`design-investor.md`・データ品質優先 `design-data.md`・実装確実性優先 `design-mvp.md`）を審査した
結果を統合した最終版であり、他の3文書は参照不要（矛盾があれば本文書が優先）。

判断に迷ったら次の優先順で決める:
1. 「スマホで片手で読める・押せる」「投資助言と誤解されない文言」「データが無い項目は正直に『未取得』」（`mobile-design.md` 3原則）
2. 「1セッションで確実に動く最小構成」「依存追加は最小限」「既存コンポーネントの再利用」
3. 「投資家の意思決定フロー ①BBに参加するか→②どの口座から→③初値で売るか持つか→④上場後いつ何を見るか」の順で画面に情報を並べる

本文書は `scratch/phase2/context.md`（現状・データソース・本人裁定）と
`scratch/mobile-design.md`（§3 デザイントークン・§6 禁止語・§7 ファイル分担・§8 納品ゲート）を前提とする。

## 統合の方針（審査結果の反映サマリ）

3案とも同じ9項目（データ拡充・統計・スコア再校正・BB戦略ボード・イベントカレンダー・プッシュ通知・
チャート・タスク分割・納品ゲート）を扱っており、差は「粒度・安全性・実装順序」。本書は次の判断で統合した:

| 論点 | 採用 | 理由 |
|---|---|---|
| 情報設計（セクション順） | investor案の「投資家フロー①〜④」原則 | 3案中もっとも一貫性があり、他2案にそのまま接ぎ木できると審査員が明記 |
| ボトムタブ5→6 | **見送り**。`/events` は新規ページとして作るが、タブ追加はしない | 3ラウンドとも審査員が「破壊的UI変更・横断修正が1タスクに集中しボトルネック」と指摘。ホーム・銘柄・BB画面からのリンク導線で発見性を確保する（data/mvp案の判断を採用） |
| `mergeIpos` シグネチャ | data案の `mergeIpos(base, auto, enriched?)`（第3引数オプショナル・後方互換） | investor/mvp案の3引数必須化は既存呼び出し元・テストの追随修正が必須で衝突リスクが高いと審査員が繰り返し指摘。オプショナル化で無傷 |
| IpoEnriched の出典管理 | data案の `sources: Partial<Record<string, SourceRef>>`（フィールド単位） | 3ラウンド共通で「データ品質の観点で最も精緻」と評価。他2案は `provenance` 1つ（レコード単位）で粒度が粗い |
| BB参加スコア | investor案の独立第3軸（既存スコア非破壊） | mvp案の「ラベル変更のみ」は審査員から繰り返し「投資判断アプリとして最重要機能が薄い」と指摘。独立軸を採用しつつ、data案の規律（バックテストで検証、ダメなら重み変更しない）を両立させる |
| BB優先順位ロジック | investor案の実配分比率（`allocationRatioPercent`）を主、mvp案の固定加点をフォールバック | data案から「配分の大小が同点になる粒度の粗さ」を指摘された弱点をinvestor版の実数%で解消しつつ、データ欠損時はmvp案の安全なフォールバックで確実性を担保 |
| Cron呼び出し方式 | mvp案の custom worker 方式に一本化（分岐なし） | investor/data案の「3段構え／実装エージェントが選ぶ」という未確定分岐が審査員から繰り返し「着手時点で技術検証が終わっていない」と指摘された |
| Web Pushライブラリ | mvp案の `@pushforge/builder` を第一候補としつつ、**着手前に動作確認必須**（検証できなければ自前実装） | mvp案の断定を単独採用せず、investor/data案が要求する「追加前に検証する」規律を明記して弱点を補う |
| 96utスクレイパーの堅牢性 | data案の `detectStructureChange` とフィクスチャ3種（正常/表記揺れ/構造変更）テスト設計 | 3ラウンド共通で運用耐性の作り込みが最も評価された |
| ローソク足の幅 | mvp案の固定335px割り切り | 依存追加ゼロ・実装確実性を優先する判断が審査員に評価された |
| タスク分割の並列度 | mvp案の「依存なしで即着手可能なタスクを5つ用意」構造をベースに、investor案の詳細な公開インターフェース記述を統合 | investor/data案は9タスクがほぼ直列待ちで1セッション完遂リスクが最も高いと3ラウンドとも指摘。mvp案の並列度の高さを踏襲しつつ、統合フェーズを1つに絞って安全性を確保 |
| 業績・株主等の詳細フィールド | data案の「Ipo型は変更せず、詳細ページはenrichedを別propsで受け取る」 | investor案は`Ipo`型を変えないと明言しつつ`underwriterAllocations`等をrepository.tsで別Map管理し二重管理リスクを生んだ（審査員指摘）。data/mvp案の「別propsで完結」の方が型がシンプル |

---

## 0. 決定事項

- 土台は既存 **Next.js 16（App Router / TypeScript strict / Tailwind v4）** を継続。`src/lib/scoring/*`・`src/lib/checklist/*`・`src/hooks/*`・`scripts/updater/*` はそのまま活かす
- **`Ipo` 型（`src/types/ipo.ts`）は変更しない**。96ut由来の拡充データ（業績・株主・幹事配分など）は新型 `IpoEnriched` に持たせ、詳細ページは `enriched?: IpoEnriched` を別 props として受け取る。理由: 型肥大化を避け、二重管理を防ぐ（investor案の反省点）
- **ボトムタブは5つのまま変更しない**（ホーム／銘柄／スクリーナー／BB／設定）。イベントカレンダーは新規ルート `/events` として作り、ホーム・銘柄一覧・BB画面からテキストリンクで導線を張る
- **依存追加**:
  - Web Push: `@pushforge/builder`（ゼロ依存・Web Crypto APIのみ・Workers公式対応と主張）を第一候補とするが、**実装エージェントは `package.json` に追加する前に `npm run preview`（Wrangler ローカル実行）で実際に動作することを確認する**。確認できなければ VAPID署名（ES256, `crypto.subtle`）と aes128gcm 暗号化を `src/lib/push/vapid.ts` / `src/lib/push/encrypt.ts` に自前実装し、依存追加はしない
  - チャートライブラリは追加しない（自前SVG）
  - Python側（`scratch/backtest/`）は標準ライブラリ＋既存venvのみ、新規pipインストールはしない
  - 上記以外の npm/pip 依存追加は禁止
- **Cloudflare構成**:
  - KV Namespace を1つ追加（`PUSH_SUBSCRIPTIONS`、無料枠内）
  - Cron Triggers を1つ追加（1日1回、JST 8:00 = UTC 23:00）
  - Cron呼び出しは **custom worker方式に一本化**（`@opennextjs/cloudflare` 公式 how-to: https://opennext.js.org/cloudflare/howtos/custom-worker）。`.open-next/worker.js` の `fetch` ハンドラをラップし `scheduled` ハンドラを追加する `worker/push-scheduled.ts` を新設し、`wrangler.jsonc` の `main` をそこに向ける
  - **`wrangler kv namespace create` の実行・Cloudflareへのnamespace作成・本番デプロイは本人確認が必要**（本人裁定の「確認で手を止めてよい4つ」の「本番反映」に該当）。設計・コード実装・ローカル `npm run preview` での検証まではこのセッションで完結させる
- **96utスクレイパーは壊れる前提で作る**: ラベル表記揺れを吸収する寛容パース、構造変化検知（`detectStructureChange`）、フィクスチャHTML3種（正常系・ラベル表記揺れ・構造大幅変更）でのテスト。フィクスチャは `scratch/phase2/fixtures/*.html`（取得済み3件）をコピーして使う（再取得不要）
- **新ルール・重みは実装前に `scratch/backtest/` で実証する**（本人裁定）。改善が確認できなければ重みは変更せず、その旨を `scratch/backtest/report-phase2.md` に明記する（これも正しい結果として扱う）
- 禁止語・localStorageキー不変・既存ファイル削除禁止・「今日」はサーバー側計算・Server Componentでデータ取得は全タスク共通（`context.md`参照）

---

## 1. データ層

### 1.1 `IpoEnriched` 型（新規 `src/types/enriched.ts`）

フィールド単位の出典管理（data案を採用）。`Ipo` 型には反映しない独立レイヤー。

```typescript
// 96ut.com から取得した「補完データ」レイヤー。手動管理の base、updater管理の auto とは
// 別の第3のレイヤー。フィールドごとに出典URL・取得日時を持つ（同じ銘柄でもフィールドによって
// 取得元・鮮度が異なりうる現実を正確にモデル化する）。Ipo型はこのレイヤーの影響を受けない
// （merge.ts で base/auto 既定値フィールドのみ埋めるが、Ipo型そのものは拡張しない）。

/** 1フィールド分の出典情報。 */
export interface SourceRef {
  /** 取得元URL（例: https://kabu.96ut.com/article/ipo/2026035/） */
  url: string;
  /** 取得日時（ISO） */
  fetchedAt: string;
}

/** 幹事団1社分の割当情報。 */
export interface UnderwriterAllocation {
  name: string;
  /** 割当株数。取得不能なら null */
  shares: number | null;
  /** 割当比率（%）。取得不能なら null */
  ratioPercent: number | null;
}

/** 大株主1件分。 */
export interface MajorShareholder {
  name: string;
  shares: number;
  ratioPercent: number;
  /** ロックアップ日数。個別記載が無ければ null（全体の lockup.days に従う） */
  lockupDays: number | null;
}

/** 会社概要。 */
export interface CompanyProfile {
  address: string | null;
  established: string | null;
  employeeCount: number | null;
  auditor: string | null;
}

/** 業績テーブル1期分。 */
export interface FinancialPeriod {
  /** 決算期（例: "2025年12月期"） */
  period: string;
  /** 単位: 百万円。96utの千円/百万円混在表記は取得時に正規化済み（§1.4 normalizeToMillionYen） */
  revenue: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  /** 売上高変化率（%） */
  revenueChangePercent: number | null;
}

/**
 * 96ut 由来の1銘柄分。すべて「取得できたものだけ」入る任意フィールド（code と sources/
 * fetchedAt/articleUrl のみ必須）。undefined はマージで無視する。
 */
export interface IpoEnriched {
  code: string;
  /** 取得元記事URL（レコード全体の代表URL。フィールド単位の出典は sources を見る）。 */
  articleUrl: string;
  /** このレコード全体の取得日時（フォールバック用）。 */
  fetchedAt: string;
  /** フィールドごとの出典。キーは下記フィールド名の文字列。 */
  sources: Partial<Record<string, SourceRef>>;

  // --- 日程 ---
  priceRangeDecisionDate?: string;
  bbPeriod?: { start: string; end: string };
  /** 公開価格決定日（=抽選日相当）。 */
  allotmentDate?: string;
  purchasePeriod?: { start: string; end: string };

  // --- 価格・株数 ---
  assumedPrice?: number;
  /** 仮条件。未発表なら省略。 */
  priceRange?: { low: number; high: number };
  offeringPrice?: number | null;
  publicShares?: number;
  saleShares?: number;
  overAllotment?: number;
  issuedShares?: number;
  offeringRatio?: number;
  /** 吸収金額（億円）。公開価格ベース。 */
  absorptionAmount?: number;
  /** 想定ベースの吸収金額（億円）。既存 absorptionAmount とは別枠。 */
  absorptionAmountAssumed?: number;
  /** 初値ベースの吸収金額（億円）。上場前は undefined。 */
  absorptionAmountInitial?: number;
  marketCap?: number;

  // --- 幹事 ---
  leadUnderwriter?: string;
  underwriters?: string[];
  underwriterAllocations?: UnderwriterAllocation[];

  // --- 会社概要・業績 ---
  companyProfile?: CompanyProfile;
  financialHistory?: FinancialPeriod[];
  eps?: number;
  bps?: number;
  dividendPerShare?: number;

  // --- 株主・VC・ロックアップ ---
  financials?: { revenue: number; revenueGrowth: number; operatingProfit: number; isProfitable: boolean };
  vcRatio?: number;
  lockup?: { days: number; hasPriceRelease: boolean; coverage: number };
  majorShareholders?: MajorShareholder[];
  existingShareholderLockupShares?: number;
  existingShareholderLockupCoverage?: number;
  vcHoldingShares?: number;
  vcLockupShares?: number;
  stockOptionShares?: number;
}
```

**取り込まない項目**（本人裁定）: 「初値予想」「BB参加姿勢」「直前予想」等の他サイトの主観評価は一切パースしない。数値・日付・株数・比率のみ取り込む。

### 1.2 `public/data/ipos.enriched.json`

`IpoEnriched[]` を code をキーにした配列で保存。**差分マージで書き込む**（今回取得できなかった銘柄のレコードは前回値を残す。96ut側の一時的な構造変化やタイムアウトでファイルが丸ごと空になる事故を避けるため。取得成功分のみ upsert し、削除は行わない）。

### 1.3 merge の優先順拡張（`src/lib/merge.ts` — foundation タスクのみが触る）

**data案のシグネチャ（後方互換オプショナル第3引数）を採用**。investor/mvp案の3引数必須化は既存呼び出し元・テストの追随修正が広範囲になり衝突リスクが高いため不採用。

```typescript
import type { IpoEnriched } from "@/types/enriched";

/** base の該当フィールドが「未取得の既定値」かどうかを判定するヘルパ群。completeness.ts の判定と整合させる。 */
function isFieldEmpty(kind: "dateRange" | "date" | "price" | "count" | "generic", value: unknown): boolean;

/**
 * base に enriched を重ねる。base の値が既定値（未取得）のときだけ enriched の値で埋める。
 * base に手動入力済みの値は enriched で上書きしない（本人が確認済みの情報を優先）。
 * skeletonFromAuto（新規発見銘柄）にも同じ規則で適用できるよう Ipo 全体を受け取る。
 */
export function applyEnriched(ipo: Ipo, enriched: IpoEnriched | undefined): Ipo;

/**
 * mergeIpos のシグネチャ変更: enriched を第3引数・オプショナルに追加する。
 * 省略時（未指定 or []）は従来と完全に同じ結果になる（既存呼び出し元・既存テストは無変更で通る）。
 * 内部処理順序: base → applyEnriched(結果, enrichedByCode.get(code)) → mergeOne(結果, auto[i])
 */
export function mergeIpos(
  base: IpoBase[],
  auto: IpoAuto[],
  enriched?: IpoEnriched[],
): Ipo[];
```

具体的な埋め規則（`applyEnriched` 内、フィールドごと。**`Ipo` 型に存在するフィールドのみ**対象。`companyProfile`/`financialHistory`/`majorShareholders` 等 `Ipo` 型に無いものは対象外＝§1.5参照）:

| base側フィールド | 「未取得」判定 | enriched埋め値 |
|---|---|---|
| `bbPeriod` | `start==="" && end===""` | `enriched.bbPeriod` |
| `allotmentDate` | `===""` | `enriched.allotmentDate` |
| `purchasePeriod` | `start==="" && end===""` | `enriched.purchasePeriod` |
| `publicShares`/`saleShares`/`overAllotment` | `===0` | 個別に埋める |
| `offeringRatio` | `===0` | `enriched.offeringRatio`（無ければ `publicShares+saleShares` から再計算） |
| `priceRange` | `low===0 && high===0` | `enriched.priceRange`（無ければ `assumedPrice` を low=high として採用） |
| `offeringPrice` | `===null` | `enriched.offeringPrice ?? null`（enriched側もnullなら上書きしない） |
| `absorptionAmount` | `===0` | `enriched.absorptionAmount` |
| `marketCap` | `===0` | `enriched.marketCap` |
| `underwriters` | `length<=1`（主幹事のみ） | `enriched.underwriters`（主幹事を含めて統合・重複排除） |
| `financials.*` | `revenueGrowth===0` を代表指標に全体を埋める | `enriched.financials`（単位は百万円、§1.4で正規化済みの値を使う） |
| `vcRatio` | `===0` | `enriched.vcRatio` |
| `lockup` | `days===0` | `enriched.lockup` |

`applyEnriched` は `skeletonFromAuto` にも通す（JPX発見銘柄の欠落項目を埋める）。

**受け入れ基準**: `src/lib/merge.test.ts` に `mergeIpos(base, auto)`（enriched省略）が従来と同一結果になるテストケースを追加（後方互換の担保）。加えて `applyEnriched` 単体テスト: base既定値→enrichedで埋まる／base手動値→enrichedで上書きされない／enriched未取得(undefined)→base既定値のまま。

### 1.4 `IpoEnriched` に無いフィールドの扱い（`repository.ts`・詳細ページ）

`companyProfile`/`financialHistory`/`majorShareholders`/`underwriterAllocations`/`eps`/`bps`/`dividendPerShare`/`existingShareholderLockup*`/`vcHoldingShares`/`vcLockupShares`/`stockOptionShares` は `Ipo` 型を変更せずに持つため、`repository.ts` に以下を追加する（foundation タスク）:

```typescript
export interface IpoDataSet {
  ipos: Ipo[];
  market: MarketData;
  enriched: IpoEnriched[]; // 追加
}

export async function getEnrichedByCode(code: string): Promise<IpoEnriched | undefined>;
export function findEnriched(all: IpoEnriched[], code: string): IpoEnriched | undefined;
```

詳細ページ（`src/app/ipo/[code]/page.tsx`、integration タスク）は `getEnrichedByCode(code)` を呼び、`IpoDetailClient` に `enriched?: IpoEnriched` として渡す。`enriched` が undefined でも `IpoDetailClient` は落ちない（該当セクションを非表示にする）。BB戦略ボード（§4）・統計（§2）も同様に `enriched` を直接参照する。

`public/data/ipos.enriched.json` が存在しない/空配列でもビルド・実行が壊れないこと（既存 `readJson` のフォールバックと同じパターンで `[]` を既定値にする）。

### 1.5 96ut スクレイパー

#### 新規ファイル（言語は TypeScript に統一 — cheerio が既存 `scripts/updater/jpx.ts` で実績があり型安全性が高いため。`scripts/enrich/` を新設し `scripts/updater/*` とは独立させる）

| パス | 役割 |
|---|---|
| `scripts/enrich/config.ts` | 定数（BASE_URL, USER_AGENT, HTTP_TIMEOUT_MS=20000, REQUEST_INTERVAL_MS=1000） |
| `scripts/enrich/sitemap.ts` | サイトマップから記事URL一覧を収集 |
| `scripts/enrich/parse96ut.ts` | 96ut記事HTML1件をパースして `IpoEnriched` を返す純関数（テスト対象） |
| `scripts/enrich/main.ts` | エントリポイント。`npm run enrich:data` |
| `scripts/enrich/parse96ut.test.ts` | パーサのテスト |
| `scripts/enrich/__fixtures__/*.html` | `scratch/phase2/fixtures/*.html` をコピー（正常系2件）＋表記揺れ版・構造変更版を手動作成 |

#### URL発見

1. `https://kabu.96ut.com/sitemap.xml`（インデックス）→ `post-sitemap.xml`〜`post-sitemap6.xml` から `article/ipo/<code>/` 形式URLを抽出（実測済み: 2024〜2026年で約190件）
2. サイトマップが取得できない場合は `article/category/ipo/`（`page/N/` ページング）をフォールバックとして使う
3. 対象は **base 157件＋auto発見40件の全銘柄**（上場済み含む。統計§2の母数を増やすため。ただし1度取得できた上場済み銘柄は再取得しない=無駄なリクエストを避ける運用を main.ts 側で行う）

```typescript
export async function fetchSitemapIndex(): Promise<string[]>;
export function extractIpoArticleUrls(sitemapXml: string): string[];
export async function collectAllIpoArticleUrls(): Promise<string[]>;
```

#### パース（`scripts/enrich/parse96ut.ts`）— data案の堅牢性設計を採用

```typescript
/** 記事タイトル「<社名>(<コード>)のIPO新規上場情報」からコードを抽出。取れなければ null。 */
export function extractCodeFromTitle(title: string): string | null;

/** 記事HTMLからテーブル行(th/td)を素朴に抽出する（cheerio使用、table.kuro tr を走査）。 */
export function extractRawFields(html: string): Record<string, string>;

/** ラベル文字列を正規化（全角/半角スペース除去、括弧の表記揺れ吸収）。 */
export function normalizeLabel(label: string): string;

/** "1,200円～1,400円" 等のレンジ文字列をパース。"未発表"/"未定"/"-" は null。全角チルダ対応。 */
export function parsePriceRangeText(text: string): { low: number; high: number } | null;

/** "2026/09/29 (火) ～ 終了: 2026/10/02 (金)" 形式からBB期間を抽出。 */
export function parseBbPeriodText(text: string): { start: string; end: string } | null;

/** 幹事団テーブル（証券会社名・割当数・割当%）をパース。「割当数」「割当(%)」が "-" なら null。 */
export function parseUnderwriterAllocations(html: string): UnderwriterAllocation[];

/** 大株主テーブル（氏名・株数・割合・ロックアップ日数）をパース。 */
export function parseMajorShareholders(html: string): MajorShareholder[];

/**
 * 96utの千円/百万円混在表記を桁数から自動判定して百万円に正規化する純関数（data案の設計）。
 * 値が10万未満なら百万円単位とみなしそのまま、10万以上なら千円とみなし1000で割る。
 */
export function normalizeToMillionYen(value: number): number;

/**
 * 「構造変更検知」: 既知ラベル候補のうち主要3つ（「ＢＢ期間」「公募価格」「主幹事証券」相当）
 * すべてが見つからない場合、ページ構造が変わった可能性が高いとみなし console.warn を出す
 * （例外は投げず、部分的に取れたフィールドはそのまま返す）。テストのため export する。
 */
export function detectStructureChange(labelsFound: Set<string>): boolean;

/**
 * 記事HTML1件を IpoEnriched へ変換する。パースは寛容（フィールド単位でtry/catch、
 * 失敗したフィールドはundefinedのまま次へ進む）。code を抽出できなければ null を返す
 * （呼び出し側でスキップしログに残す）。取得できた全フィールドに sources[フィールド名] を設定する。
 */
export function parse96utArticle(
  html: string,
  articleUrl: string,
  fetchedAtIso: string,
): IpoEnriched | null;
```

ラベル候補は既知の表記揺れを配列で複数持つ（例: BB期間 = `["ＢＢ期間", "BB期間", "ブックビルディング期間"]` のいずれかにマッチ）。見つからないラベルは該当フィールドを省略（undefined）。

#### `main.ts` の処理フロー

1. `collectAllIpoArticleUrls()` でURL一覧取得
2. 対象を絞る: base/auto の code のうち **status が upcoming/bb_open/priced の銘柄は毎回再取得、listed銘柄で既にenrichedレコードがあるものはスキップ**（無駄なリクエストを避ける）
3. 1件ずつ `1000ms` 間隔で fetch（UA明示・タイムアウト20秒・失敗はwarn+スキップして続行）
4. `parse96utArticle()` でパース。null（code抽出失敗）はスキップしてログ出力
5. 既存 `ipos.enriched.json` を読み込み、取得成功分だけ code で upsert（差分マージ、§1.2）
6. サマリ出力: 対象件数・成功件数・失敗件数・失敗URL一覧・`detectStructureChange` が発火した記事数

`package.json` scripts に `"enrich:data": "tsx --env-file-if-exists=.env scripts/enrich/main.ts"` を追加。

#### テスト（`scripts/enrich/parse96ut.test.ts`）

- フィクスチャ1・2（正常系、`scratch/phase2/fixtures/96ut-2024040.html` `96ut-2026020.html`）: 全主要フィールドが期待通り抽出できる
- フィクスチャ3（`96ut-2026035-upcoming.html`、仮条件未発表）: `priceRange` が undefined、他フィールドは取れる
- フィクスチャ4（手動作成・ラベル表記揺れ版）: 揺れを吸収して抽出できる
- フィクスチャ5（手動作成・構造大幅変更版）: `detectStructureChange` が true を返す
- `parsePriceRangeText`: "1,200円～1,400円" / "未発表" / "-" / 全角チルダ
- `parseBbPeriodText`: 開始・終了が同一行 / 曜日カッコ書き
- `extractCodeFromTitle`: 通常形式 / コード4桁数字 / コード3桁+英字1桁
- `normalizeToMillionYen`: 境界値（99999→そのまま、100000→/1000、実データ相当値）
- `extractIpoArticleUrls`: 正しいURLのみ抽出・重複排除

**受け入れ基準**:
- `npm run enrich:data` が実行でき、`public/data/ipos.enriched.json` が生成される
- JPX発見銘柄（insufficient）のうち96utに記事がある銘柄は `partial` 以上に改善する
- enrichedデータを持つ全レコードの `sources` に最低1件の出典が入っている

---

## 2. 統計（純関数と定義）

data案の型設計＋investor案のUI配置（詳細ページで③の判断材料を最初に見せる）を統合。

### 2.1 `src/lib/stats/index.ts`（新規、stats タスクが単独担当）

```typescript
import type { Ipo, Market } from "@/types/ipo";

/** 吸収金額帯（億円）。report.md の区切りに合わせる（1-5億/100億超で成績が大きく違う）。 */
export type AbsorptionBand = "under10" | "10to30" | "30to100" | "over100";
export function classifyAbsorptionBand(absorptionAmount: number): AbsorptionBand;
export const ABSORPTION_BAND_LABELS: Record<AbsorptionBand, string>;

/** オファリングレシオ帯（%）。report.md: 10%未満+53.1% / 50%超-2.9%。 */
export type OfferingRatioBand = "under10" | "10to30" | "30to50" | "over50";
export function classifyOfferingRatioBand(offeringRatio: number): OfferingRatioBand;
export const OFFERING_RATIO_BAND_LABELS: Record<OfferingRatioBand, string>;

export interface OutcomeSample {
  code: string;
  name: string;
  /** 初値騰落率（%）。既存 src/lib/format.ts の initialReturnRate をそのまま使う。 */
  returnRate: number;
}

export interface OutcomeDistributionResult {
  /** 対象件数（母数）。 */
  sampleCount: number;
  /** 初値が公開価格を上回った件数の割合（%）。母数0なら null。 */
  winRate: number | null;
  /** 初値騰落率の中央値（%）。母数0なら null。 */
  medianReturnRate: number | null;
  /** 初値騰落率の平均（%）。母数0なら null。 */
  meanReturnRate: number | null;
  /** 参考として返す個別サンプル（新しい順、最大10件）。 */
  samples: OutcomeSample[];
}

/**
 * 「吸収金額帯×市場」が一致する上場済み銘柄の初値実績分布を返す（targetIpo自身は除外）。
 * 地合いは対象銘柄の上場日時点のものを厳密に復元できないため v1 では条件に含めない
 * （型として拡張余地は残すが、絞り込みは市場＋帯のみ）。
 */
export function outcomeDistributionByAbsorptionBand(allIpos: Ipo[], targetIpo: Ipo): OutcomeDistributionResult;

/** 主幹事別の公募割れ率（初値<公開価格の割合）。上場済み・公開価格/初値あり銘柄のみ対象。 */
export interface UnderwriterBreakEvenStat {
  underwriter: string;
  sampleCount: number;
  breakEvenRate: number; // %
  meanReturn: number;
  /** 母数が少なく参考程度であることを示すフラグ（count < 5）。 */
  lowSample: boolean;
}
export function underwriterBreakEvenStats(allIpos: Ipo[], minSample?: number /* 既定2 */): UnderwriterBreakEvenStat[];

/** 特定の主幹事1社分の統計を1件返す（詳細ページ・BB戦略ボードで使う）。母数0ならnull。 */
export function underwriterBreakEvenStat(allIpos: Ipo[], underwriter: string): UnderwriterBreakEvenStat | null;

/** OR帯別の初値騰落率分布（スクリーナー・BB戦略ボードの参考表で使う）。 */
export interface OfferingRatioBandStat {
  band: OfferingRatioBand;
  sampleCount: number;
  medianReturnRate: number | null;
  winRate: number | null;
}
export function offeringRatioBandStats(allIpos: Ipo[]): OfferingRatioBandStat[];
```

中央値は配列を複製してソートし、偶数件は中央2件の平均。ゼロ除算・空配列は必ず `null`/`sampleCount:0` を返す（例外を投げない）。

### 2.2 UI配置

- **詳細ページ**（`src/components/detail/OutcomeDistribution.tsx`、新規、detail タスク）: 価格セクション直後・スコアセクションより前（③の判断材料を最初に見せる、§8で確定）
- **統計専用ページは作らない**（data案の弱点「わざわざ見に行かないと出てこない」を踏襲しない）。詳細ページの `OutcomeDistribution` に統合し、スクリーナー画面の各プリセット説明文に「過去実績: 平均+X% 母数N件」を1行添える形（screener タスク、任意拡張）で判断フローに組み込む

表示文言:
- 見出し: 「類似条件の初値実績」
- 条件行: 「吸収金額 {帯ラベル}・{市場} で上場した銘柄」
- サンプル0件: 空状態カード「同条件の実績データがまだありません（参考情報）」
- サンプル1〜4件: 見出し直下に「参考情報（母数{n}件、目安として弱い）」を必ず表示
- サンプル5件以上: 「参考情報（母数{n}件）」
- 本体: 3列（初値超え率／騰落率中央値／母数）＋ 直近サンプル最大5件を `code・name・騰落率%` の ListRow で列挙
- 末尾1行: 「上場済み銘柄の実績を機械的に集計した値です。将来の値動きを示すものではありません。」

**受け入れ基準**:
- 母数0件のとき絶対にpass/fail断定文言を出さない
- 帯の境界値（9.9/10/29.9/30/99.9/100億円）・winRate=0%とnull(母数0)の区別・中央値の偶数/奇数件をテストでカバー

---

## 3. スコア再校正（BB参加スコア）

investor案の「独立第3軸」構造を採用（既存需給/ファンダ2軸は非破壊）。data案の規律（バックテストで実証し、ダメなら重みを変えない）を実行手順として明記する。

### 3.1 実証根拠（`report.md` から採用する項目のみ）

| 要因 | 実証内容 | 採用可否 |
|---|---|---|
| 吸収金額 | 1〜5億円 平均+221% vs 100億円超 +28.9% | 採用（既存 `scoreAbsorption` を再利用） |
| オファリングレシオ | 10%未満 +53.1% vs 50%超 −2.9% | 採用（新規項目） |
| 主幹事別公募割れ率 | 実データで差が出る（例: 差が大きい銘柄で10pt超） | 採用（§2 `underwriterBreakEvenStat` の実績値を使う。ハードコード係数にしない） |
| 仮条件上限決定 | 「仮条件が想定より上振れ」が良い兆候 | 採用（既存checklistの`checkPriceRangeRevision`と同ロジック） |
| ロックアップ | VC比率×ロック強度の組合せが出口売り圧力に影響 | 採用（既存 `scoreVcLockup` を再利用） |
| 地合い | 強い地合いほど初値が良い | 採用（既存 `scoreSentiment` を再利用） |
| S〜Dランク・RSI逆張り・利確目標絶対水準 | 実証で逆効果 or 設計バグと判定済み | **不採用**（Streamlit版の失敗を踏襲しない） |

### 3.2 型定義・シグネチャ（新規 `src/lib/scoring/bb.ts`、scoring タスク担当。既存 `scoring/*` は読み取り専用のまま、新規ファイルのみ追加）

```typescript
import type { Ipo } from "@/types/ipo";
import type { ScoreSettings } from "./types";
import type { UnderwriterBreakEvenStat } from "@/lib/stats";

export type BbScoreItemKey =
  | "absorption"
  | "offeringRatioBb"
  | "underwriterTrack"
  | "priceRangePosition"
  | "vcLockup"
  | "sentiment";

export const BB_SCORE_KEYS: BbScoreItemKey[];
export const BB_SCORE_ITEM_LABELS: Record<BbScoreItemKey, string>;

export type BbScoreWeights = Record<BbScoreItemKey, number>;

/**
 * 実証根拠に基づく初期重み（暫定値。§3.4のバックテストで検証後に確定する）。
 * 数値根拠は実証内容の差の大きさに比例させる: オファリングレシオ（53.1pt差）と
 * 吸収金額（192pt差）を最重量、主幹事実績と仮条件位置を中、VCロックアップ・地合いを軽め。
 */
export const DEFAULT_BB_WEIGHTS: BbScoreWeights = {
  absorption: 4,
  offeringRatioBb: 4,
  underwriterTrack: 3,
  priceRangePosition: 3,
  vcLockup: 2,
  sentiment: 2,
};

export interface BbScoreItemOutput {
  key: BbScoreItemKey;
  label: string;
  points: number; // -2〜+2
  weight: number;
  contribution: number;
  rawText: string;
  reason: string;
}

export interface BbScoreResult {
  score: number; // 0〜100
  items: BbScoreItemOutput[];
}

/** オファリングレシオ: <10%=+2 / <20%=+1 / <30%=0 / <50%=-1 / それ以上=-2。 */
export function scoreOfferingRatioBb(ipo: Ipo): { points: number; rawText: string; reason: string };

/**
 * 主幹事別公募割れ率の実績を使う。stats（underwriterBreakEvenStat）の結果を引数で受け取る
 * （純関数を保つため allIpos を直接読まない）。母数5件未満は unknown 扱いで0点。
 */
export function scoreUnderwriterTrack(stat: UnderwriterBreakEvenStat | null): { points: number; rawText: string; reason: string };

/** 仮条件の位置。checklistの checkPriceRangeRevision と同じ判定をスコア化。 */
export function scorePriceRangePosition(ipo: Ipo): { points: number; rawText: string; reason: string };

export function scoreBbParticipation(
  ipo: Ipo,
  settings: ScoreSettings, // sentiment のみ使用
  underwriterStat: UnderwriterBreakEvenStat | null,
  weights?: BbScoreWeights,
): BbScoreResult;
```

`absorption`/`vcLockup`/`sentiment` は `scoring/items.ts` の `scoreAbsorption`/`scoreVcLockup`/`scoreSentiment` をそのまま import して再利用（ロジック重複を避ける。`scoring/items.ts` は変更しない）。

### 3.3 需給重視プリセットは変更しない

`SUPPLY_DEMAND_WEIGHTS`（既存2軸スコア）は非破壊の方針を維持し、変更しない。BB参加スコアは完全に独立した第3軸として追加する（mvp案の「ラベル変更のみ」は不採用。審査員が繰り返し「投資判断アプリとして最重要機能が薄い」と指摘したため）。

### 3.4 バックテスト手順（scoring タスクが実装前に実行。data案の規律を踏襲）

```bash
cd /Users/kazukiyoshida/ipo-analyzer/scratch/backtest
./venv/bin/python recalibrate_bb.py
```

`recalibrate_bb.py`（新規）の処理:
1. `data/ipo_list.csv` と `data/fundamentals.csv` を code でJOINし、`offer_price`/`first_price` が両方揃う行のみ残す
2. 目的変数 `initial_return = (first_price - offer_price) / offer_price * 100`
3. §3.2の6項目それぞれの `points`（-2〜+2）を **Pythonで同じ閾値ロジックを再実装**して算出（TypeScriptを直接呼べないため）
4. 各項目の `points` と `initial_return` の相関係数（Pearson・Spearman）を算出
5. `DEFAULT_BB_WEIGHTS`（暫定値）でスコア降順上位30% vs 下位30%群の平均初値騰落率を比較
6. 結果を `scratch/backtest/report-phase2.md` に記録する

**受け入れ基準**:
- `report-phase2.md` に相関表・上位/下位群比較が記載されている
- 上位群が下位群を明確に上回れば `DEFAULT_BB_WEIGHTS` はそのまま確定として採用する
- 上回らない、または相関が弱い項目があれば、その項目の重みを1段階下げる保守的な調整を1回だけ行い、再検証する。それでも改善しない場合は暫定値のまま実装し「重みは今後の実データ蓄積で見直す」旨を `report-phase2.md` に明記する（**新軸の実装自体は見送らない**。data案の「効果不明なら重み変更しない」規律は既存2軸スコアに対するものであり、BB参加スコアは新規実証データに基づく新機能のため異なる扱い＝実装は進める）

### 3.5 UI表示

- 詳細ページ: 既存3ゲージ（需給・ファンダ・総合）の横に4つ目「BB参加」ゲージを追加（`ScoreGauges.tsx` 拡張、detail タスク）。`completeness.level === 'insufficient'` では非表示
- スコア内訳の `<details>` に「BB参加スコアの内訳」を追加（既存 `ScoreBreakdown` を再利用、`BbScoreItemOutput[]` → `ScoreItemResult[]` 互換の薄いアダプタを detail タスクが用意）
- ホームの「スコア上位ピックアップ」は総合スコア（需給+ファンダ）のまま変更しない。代わりに新規セクション「BB参加候補」（§7）でBB参加スコア上位を見せる
- `/bb` 画面のカードに「BB参加スコア」バッジを追加（§4）

### 3.6 テスト観点

- `scoreOfferingRatioBb`: 境界値 9.9/10/19.9/20/29.9/30/49.9/50%
- `scoreUnderwriterTrack`: 母数5件未満はunknown(0点)、5件以上は段階判定
- `scorePriceRangePosition`: checklistと同じ境界値
- `scoreBbParticipation`: 全項目0点でも50点に丸まる（既存 `buildAxis` と同じゼロ除算回避方式）
- 既存 `scoring/scoring.test.ts` は無変更で全通過

---

## 4. BB戦略ボード

investor案の実配分比率ロジックを主、mvp案の固定加点をフォールバックとして統合（data案が指摘した「配分の大小が同点になる粒度の粗さ」を解消しつつ、データ欠損時の安全性を確保）。

### 4.1 新規ファイル（bb タスク。`src/lib/bb/` ディレクトリを新設）

| パス | 役割 |
|---|---|
| `src/lib/bb/priority.ts` | 申込優先順位の純関数 |
| `src/lib/bb/priority.test.ts` | テスト |
| `src/lib/bb/fundLock.ts` | 資金拘束カレンダーの純関数 |
| `src/lib/bb/fundLock.test.ts` | テスト |
| `src/components/bb/BrokerPriorityList.tsx` | 銘柄1件の証券会社優先順位リスト |
| `src/components/bb/FundLockCalendar.tsx` | 資金拘束カレンダー |
| `src/components/bb/BbIpoCard.tsx`（既存拡張） | BB参加スコアバッジ・優先順位トップの強調表示 |

### 4.2 申込優先順位（`src/lib/bb/priority.ts`）

```typescript
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { UnderwriterAllocation } from "@/types/enriched";

export interface BrokerPriorityEntry {
  broker: Broker;
  /** 0〜100の優先度スコア（口座選びの参考値、高いほど当選期待値が高い目安）。 */
  priorityScore: number;
  /** 幹事団内での割当株数比率（%）。取得不能なら null。 */
  allocationRatioPercent: number | null;
  /** 主幹事かどうか。 */
  isLead: boolean;
  /** 幹事団に含まれるか（主幹事含む）。 */
  inSyndicate: boolean;
  reason: string;
}

const LOTTERY_TYPE_COEFFICIENT: Record<Broker["lotteryType"], number> = {
  equal: 1.0,
  point: 0.9,
  stage: 0.8,
  proportional: 0.7,
};

/**
 * 1銘柄について、証券会社ごとの申込優先順位を算出する。
 *
 * allocations（96ut由来の実配分比率）が取得できている場合:
 *   priorityScore = allocationRatioPercent × 抽選方式係数 × 10（0〜100にスケール）
 *                   + （requiresDeposit=false なら +5 ボーナス）
 *   根拠: 幹事団内の割当株数比率が大きいほど当選枠が多い。抽選方式係数
 *   （equal=1.0, point=0.9, proportional=0.7, stage=0.8）は完全平等・ポイント制が
 *   資金力に依存せず個人投資家に有利、比例配分は大口優位で不利という構造的事実に基づく。
 *   前受金なしは資金拘束が無く申込みやすいためボーナス。
 *
 * allocations が取得できない場合（フォールバック、mvp案の安全策を採用）:
 *   主幹事(lead): 60点 / 引受幹事(member): 30点 / 非シンジケート: 対象外
 *   に抽選方式係数・前受金ボーナスを同様に乗算・加算する。
 *   allocationRatioPercent は null のまま返し、UIで「幹事配分 未取得」と明示する
 *   （data案の指摘=配分の大小が同点になる粒度の粗さを避けるため、実数%が取れれば
 *   必ずそちらを優先し、フォールバックは最後の手段であることを明確にする）。
 *
 * 幹事団に含まれない証券会社は結果に含めない。降順ソート済みで返す
 * （同点は inSyndicate→isLead→allocationRatioPercent降順→名前順）。
 */
export function rankBrokersForIpo(
  ipo: Ipo,
  brokers: Broker[],
  allocations: UnderwriterAllocation[] | undefined,
): BrokerPriorityEntry[];

export const LOTTERY_TYPE_LABELS: Record<Broker["lotteryType"], string> = {
  equal: "完全平等",
  point: "ポイント制",
  stage: "ステージ制",
  proportional: "比例配分",
};
```

### 4.3 資金拘束カレンダー（`src/lib/bb/fundLock.ts`）

期間の重なり判定は境界を「重なる」とみなす（mvp案の明示的仕様。BB期間終了日=別銘柄BB期間開始日は資金拘束が同日に両方発生しうるため）。

```typescript
import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { BbState } from "@/types/userData";

export interface FundLockPeriod {
  ipo: Ipo;
  broker: Broker;
  /** 拘束開始日（購入申込期間の開始、無ければBB期間開始）。 */
  start: string;
  /** 拘束終了日（購入申込期間の終了、無ければ抽選日、無ければBB期間終了）。 */
  end: string;
  /** 拘束金額目安（円）。既存 estimatedLockAmount を流用。 */
  amount: number;
}

/**
 * 「申込予定・申込済」ステータスの銘柄×証券会社（前受金が必要な証券会社のみ）について
 * 資金拘束期間の一覧を返す。日付が確定していない項目は除外する。
 */
export function buildFundLockPeriods(ipos: Ipo[], brokers: Broker[], bbState: BbState): FundLockPeriod[];

/** 2つの期間が重なっているか。**境界が同日なら「重なる」とみなす**（半開区間ではなく閉区間）。 */
export function periodsOverlap(a: FundLockPeriod, b: FundLockPeriod): boolean;

/** 同一証券会社内で期間が重なるグループをまとめる。証券会社ごとにグループ配列を返す。 */
export interface FundLockGroup {
  broker: Broker;
  overlapping: FundLockPeriod[];
  totalAmount: number;
}
export function groupOverlappingLocks(periods: FundLockPeriod[]): FundLockGroup[];
```

### 4.4 UI構成: `/bb` 画面（`BbManagerClient.tsx` 変更、bb タスク）

既存順（サマリ→対象銘柄カード一覧）の後に以下を追加:

1. **サマリ**（既存 `BbSummary`。変更なし）
2. **資金拘束カレンダー**（新規 `FundLockCalendar`）: `groupOverlappingLocks` の結果、`overlapping.length >= 2` の証券会社だけをカードで列挙。見出し「資金拘束の重なり」。**重なりが0件ならセクション自体を非表示**（空状態は出さない、ノイズにしない）
3. **対象銘柄カード一覧**（既存 `BbIpoCard` 拡張）: BB参加スコアバッジ（`insufficient`銘柄は非表示）・証券会社別ステータス行を優先順位順に並び替え・優先度トップに `Chip tone="accent"` で「優先」バッジ

表示文言: 優先度説明（`<details>` または常時1行）「幹事配分{比率}%・{抽選方式ラベル}」（allocationRatioPercentがnullなら「幹事配分 未取得・{抽選方式ラベル}」）。

**このセクションへのリンクを `/events`（§5）への導線としても使う**（見出し脇に「上場後の予定はイベント一覧で確認できます →」の1行リンク）。

### 4.5 テスト観点

- `rankBrokersForIpo`: allocationsあり/なし双方のスコア算出、幹事団に含まれない証券会社が除外される、同点時のソート順
- `periodsOverlap`: 境界（end===startは重なりとみなす）
- `groupOverlappingLocks`: 3銘柄が同一証券会社で一部重なる場合のグルーピング
- `buildFundLockPeriods`: `requiresDeposit=false` の証券会社は対象外

**受け入れ基準**: `/bb` 画面375pxで資金拘束カレンダーのカードが横はみ出しなく表示。優先順位トップが視覚的に区別できる。既存BBステータス変更機能（localStorage保存）が壊れていない。

---

## 5. イベントカレンダー

タブは追加しない（§0の方針）。新規ルート `/events` として作り、ホーム・銘柄一覧・BB画面からリンク導線を張る。

### 5.1 新規ファイル（events タスク）

| パス | 役割 |
|---|---|
| `src/lib/events/index.ts` | 横断イベント収集の純関数 |
| `src/lib/events/events.test.ts` | テスト |
| `src/app/events/page.tsx` | イベントカレンダー画面（Server Component） |
| `src/components/events/EventsClient.tsx` | クライアント本体 |
| `src/components/events/EventListItem.tsx` | 1件表示 |

### 5.2 型定義・純関数シグネチャ（`src/lib/events/index.ts`）

```typescript
import type { Ipo } from "@/types/ipo";

export type CalendarEventKind =
  | "bbStart" | "bbEnd" | "allotment" | "purchaseStart" | "purchaseEnd" | "listing"
  | "lockupExpiry"       // listingDate + lockup.days
  | "priceReleaseWatch"  // 1.5倍解除条項ありの銘柄で、現在値が公開価格1.4倍到達時点から表示
  | "firstEarnings"
  | "largeHoldingReport";

export interface CalendarEvent {
  ipo: Ipo;
  kind: CalendarEventKind;
  date: string; // YYYY-MM-DD
  detail: string;
}

export const CALENDAR_EVENT_LABELS: Record<CalendarEventKind, string>;

/**
 * 既存 upcomingEvents（home/index.ts）のBB系4種に、上場後3種
 * （lockupExpiry, firstEarnings, priceReleaseWatch）を加えた横断イベント一覧。
 * largeHoldingReport は過去日程のため別関数 recentLargeHoldingReports に分離。
 * days: 対象期間（today起点、既定90日）。
 */
export function upcomingCalendarEvents(ipos: Ipo[], todayIso: string, days?: number): CalendarEvent[];

/** ロックアップ解除日イベント（lockup.days>0 かつ listingDateありのみ）。共有ヘルパ addDaysIso を使う。 */
export function lockupExpiryEvent(ipo: Ipo, todayIso: string): CalendarEvent | null;

/** 1.5倍解除ラインの監視イベント。1.4倍到達時点から「本日時点で監視中」として返す。 */
export function priceReleaseWatchEvent(ipo: Ipo, todayIso: string): CalendarEvent | null;

export function firstEarningsEvent(ipo: Ipo): CalendarEvent | null;

/** 直近30日以内に提出された大量保有報告書（過去日程・"新着"として別枠表示）。 */
export function recentLargeHoldingReports(ipos: Ipo[], todayIso: string, withinDays?: number): CalendarEvent[];
```

`lockupExpiryEvent`/`priceReleaseWatchEvent` は `checklist/items.ts` の `checkLockupExpiry`/`checkPriceReleaseLine` と判定ロジックが重複するが、戻り値の型が異なるため **checklist側は変更せず** events側に独立実装する。日付計算の共通ヘルパ `addDaysIso`/`daysBetween` は `src/lib/date.ts`（新規、foundation タスク）に切り出し、`events/index.ts` から import する（checklist側の変更は不要、events側だけが新ヘルパを使う設計にして共有ファイル変更を最小化する）。

### 5.3 UI構成: `/events` 画面

1. 「新着」（`recentLargeHoldingReports`、直近30日）。0件ならセクション非表示
2. 「今後90日の予定」（`upcomingCalendarEvents`、日付昇順）。0件なら `EmptyState`「今後90日以内の予定はありません」

1件の表示: 日付・イベント種別Chip・銘柄名・1行detail・タップで詳細ページへ（44pxタップ領域）。日付ごとに小見出し（`YYYY/MM/DD`）でグルーピング。

### 5.4 導線（タブを増やさない代替）

- ホーム画面「今後14日の予定」セクション見出し下に1行「上場後の予定は `/events` でまとめて確認できます →」（home タスク）
- `/bb` 画面（§4.4末尾でリンク済み）
- `/ipos` 画面上部に「イベントカレンダーを見る →」リンク（ipos タスク）

### 5.5 受け入れ基準

- `/events` の全イベント種別が正しい日付順で表示される
- 既存 `/ipo/[code]` の投資判断チェックリストの表示・判定は変更されていない
- ホームの「今後14日の予定」（既存 `upcomingEvents`）は変更なし（統合はしない、据え置き）
- 375px・1280pxで `/events` が横はみ出しなく表示される

---

## 6. プッシュ通知（Web Push + Workers Cron + KV）

mvp案の一本化されたCron方式を採用（investor/data案の「3段構え・未確定分岐」は不採用）。

### 6.1 技術方針

- **ライブラリ**: `@pushforge/builder`（npm、ゼロ依存、Web Crypto APIのみで動作、Workers公式互換を謳う）を第一候補とする。`buildPushHTTPRequest({ privateJWK, subscription, message })` の結果を `fetch()` するだけの薄い設計
- **着手前の検証必須**（investor/data案の規律を明記）: `package.json` へ追加する前に、実装エージェントが `npm run preview`（Wrangler ローカル実行）で実際に動作すること（VAPID署名生成・暗号化・送信リクエスト構築がエラーなく完了すること）を確認する。**確認できなければ依存追加をせず**、VAPID署名（ES256, `crypto.subtle`）を `src/lib/push/vapid.ts`、ペイロード暗号化（aes128gcm, RFC8291）を `src/lib/push/encrypt.ts` に自前実装する。どちらの経路でも `src/lib/push/notify.ts`（通知対象選定・文面組み立ての純関数層）は共通化し、送信層とロジック層を分離する
- **VAPIDキー生成**: `.env`（ローカル開発用）に `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`（またはJWK形式、選定ライブラリに合わせる）/`VAPID_SUBJECT`（mailto:）。本番は `wrangler secret put` で投入（**このコマンド実行は本番反映に該当するため本人確認後**）。公開鍵はクライアントJSに埋め込む必要があるため `NEXT_PUBLIC_VAPID_PUBLIC_KEY` として通常の環境変数（Secretではない）に置く
- **KV Namespace**: 購読情報（endpoint + keys + 通知カテゴリ設定）を保存。無料枠（読み取り10万/日・書込み/削除/一覧 各1,000/日・合計1GB）で個人利用規模に十分。バインディング名 `PUSH_SUBSCRIPTIONS`
- **Cron**: `@opennextjs/cloudflare` の **custom worker方式に一本化**（公式 how-to: https://opennext.js.org/cloudflare/howtos/custom-worker）。`.open-next/worker.js` の `fetch` ハンドラをそのまま再エクスポートし `scheduled` ハンドラを追加する薄いラッパー `worker/push-scheduled.ts` を書き、`wrangler.jsonc` の `main` をそのラッパーに向ける。1日1回（JST 8:00 = UTC 23:00）

### 6.2 データフロー

```
[クライアント] 設定画面「通知を有効にする」タップ
  → Notification.requestPermission()
  → serviceWorker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  → POST /api/push/subscribe（購読情報＋通知カテゴリ設定）

[POST /api/push/subscribe]（新規）→ KVに保存（key: endpointのSHA-256ハッシュ）
[POST /api/push/unsubscribe]（新規）→ KVから削除

[Cron（毎日 JST 8:00）]
  → scheduled ハンドラ起動
  → KVから全購読者列挙
  → getAllIpos() で全銘柄取得、todayIso（JST）算出
  → selectNotifiableEvents(events, todayIso) で「明日BB開始」「明日抽選日」
    「本日購入期限」「ロックアップ解除3日以内」「1.5倍ライン新規到達」を抽出
  → 各購読者の enabledKinds / watchedCodes と一致する通知のみ送信
  → VAPID署名付きで送信。404/410（購読失効）はKVエントリを削除
```

### 6.3 型定義（新規 `src/types/push.ts`、push タスク）

```typescript
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushEventKind = "bbStart" | "allotment" | "purchaseDeadline" | "lockupExpiry" | "priceReleaseWatch";

export interface PushSubscriberRecord {
  subscription: PushSubscriptionJson;
  /** 通知を受け取るイベント種別。既定は全種別。 */
  enabledKinds: PushEventKind[];
  /** ウォッチ中銘柄のみ通知する（既定true。v1では固定でよい）。空配列は「ウォッチ全銘柄」。 */
  watchedCodes: string[];
  createdAt: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  kind: PushEventKind;
  code: string;
}
```

### 6.4 ファイル一覧（push タスク。新規ファイルのみ、既存ファイルは触らない）

| ファイル | 責務 |
|---|---|
| `src/types/push.ts` | §6.3 の型 |
| `src/lib/push/subscription.ts` | KV読み書きヘルパー（`saveSubscriber`/`deleteSubscriber`/`listSubscribers`。`KVNamespace` 型経由でモック注入可能にする） |
| `src/lib/push/notify.ts` | `selectNotifiableEvents(events, todayIso)`（純関数）、`buildPayload(kind, ipo)` |
| `src/lib/push/vapid.ts`（ライブラリ検証NG時のみ） | VAPID署名の自前実装 |
| `src/lib/push/encrypt.ts`（同上） | aes128gcm暗号化の自前実装 |
| `src/app/api/push/subscribe/route.ts` | POST購読登録 |
| `src/app/api/push/unsubscribe/route.ts` | POST購読解除 |
| `worker/push-scheduled.ts`（プロジェクトルート直下） | `scheduled` ハンドラ（custom worker本体） |
| `worker/run-push-notifications.ts` | 実処理（KV列挙・通知送信。テスト可能な形に分離） |
| `src/components/settings/PushOptIn.tsx` | 設定画面トグル |
| `src/hooks/usePushSubscription.ts` | 購読状態のフック |
| `public/sw.js` への追記（push/notificationclick部分のみ） | 既存ファイルへの追記。**foundation タスクが基本部分を作った後**に push タスクが追記する（同一ファイルを触る唯一の例外） |

```typescript
// worker/push-scheduled.ts
// @ts-ignore .open-next/worker.js はビルド時に生成される
import { default as nextHandler } from "../.open-next/worker.js";
import { runPushNotifications } from "./run-push-notifications";

export default {
  fetch: nextHandler.fetch,
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPushNotifications(env));
  },
} satisfies ExportedHandler<CloudflareEnv>;
```

### 6.5 `wrangler.jsonc` 変更（integration タスク。設定ファイルへの記述のみ、実際のnamespace作成・デプロイは本人確認後）

```jsonc
{
  "main": "./worker/push-scheduled.ts",
  "kv_namespaces": [
    { "binding": "PUSH_SUBSCRIPTIONS", "id": "<wrangler kv namespace createで得たID。本人確認後に取得>" }
  ],
  "triggers": { "crons": ["0 23 * * *"] },
  "vars": { "NEXT_PUBLIC_VAPID_PUBLIC_KEY": "<公開鍵>" }
  // VAPID_PRIVATE_KEY は wrangler secret put で別途投入（平文でファイルに書かない）
}
```

Cron Triggersは無料プランで1 Workerあたり最大3本・アカウント全体5本まで。1本のみ使用するため問題ない。

### 6.6 UI: 設定画面 `PushOptIn.tsx`（settings タスク）

- 見出し「プッシュ通知」
- iOS制約の案内: 「iOSではホーム画面に追加後のみ通知を許可できます」。`navigator.standalone` または `matchMedia('(display-mode: standalone)')` で判定し、非standalone時はトグルをdisabledにして案内文のみ表示
- 通知対象: 「ウォッチリストの銘柄のみ（既定）」固定（v1では全銘柄オプトインは作らない）
- 許可状態: `Notification.permission` をChip表示。`denied` のときはブラウザ設定変更の案内文のみ（機械的な再要求はしない）
- 未対応ブラウザ（`'PushManager' in window` が false）: 「このブラウザは通知に対応していません」

### 6.7 受け入れ基準

- `.env.example` に `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`（値は空、生成コマンド例をコメント）
- custom worker構成（`main`変更後）でも `npm run build` が成功する
- `npm run preview` でKVバインディングが解決でき、`/api/push/subscribe` へのPOSTでローカルKVに書き込まれることを確認
- `selectNotifiableEvents` のドライラン（`tsx worker/run-push-notifications.ts --dry-run` 相当）で対象件数のみログ出力できる
- iOS standalone判定でトグルの活性/非活性が切り替わる
- **本番Cron起動での実配信確認は本人が別途行う**（本番デプロイは本人確認必須のためこのセッションでは完了基準に含めない）

---

## 7. ホーム画面のセクション順再設計

投資家フロー①〜④に沿って並べ替える（`HomeClient.tsx` 変更、home タスク）。タブは増やさないが、セクション構成・順序は再設計する。

| 順 | セクション | 変更内容 | 対応フロー |
|---|---|---|---|
| 1 | 見出し・免責注記 | 変更なし | — |
| 2 | 地合いカード（`SentimentBanner`） | 変更なし | 共通前提 |
| 3 | サマリー（KPI4枚） | 変更なし | 市場全体の実績把握 |
| 4 | **BB参加候補ハイライト**（新規） | §3のBB参加スコア上位3件。既存「需給ハイライト」の**前に追加**（置き換えない） | ① |
| 5 | 今後14日の予定（`EventTimeline`） | 変更なし。見出し下に「上場後の予定は `/events` でまとめて確認できます →」を追記 | ④ |
| 6 | スコア上位ピックアップ（`TopPicks`） | 変更なし。見出し脇のnoteを「総合スコア（需給・ファンダ）の機械的な上位」に微調整 | 銘柄探索全般 |
| 7 | 需給ハイライト（`SupplyDemandHighlights`） | 変更なし | 銘柄探索全般 |
| 8 | 免責 | 変更なし | — |

### 新規セクション「BB参加候補ハイライト」

`src/lib/home/index.ts` に純関数追加（home タスク）:

```typescript
export interface BbHighlightItem {
  ipo: Ipo;
  bbScore: number;
}

/**
 * BB参加スコア上位3件。対象は status が upcoming/bb_open/priced のみ（listed除外）。
 * completeness が insufficient の銘柄は除外。呼び出し側（HomeClient）が
 * scoreBbParticipation を事前計算して渡す（scoringへの依存はコンポーネント層に閉じる）。
 */
export function topBbCandidates<T extends BbHighlightItem>(
  scored: T[],
  n?: number,
  completenessFn?: (ipo: Ipo) => CompletenessResult,
): T[];
```

UIは既存 `TopPicks.tsx` とほぼ同型（`IpoCard` 変更なしで実装可能。既存 `ScorePill` を「BB参加」ラベルで表示するだけに留める）。

- 見出し: 「BB参加候補」
- note: 「BB参加スコア（吸収金額・OR・主幹事実績等の機械的集計）の上位。参考情報です」
- 0件時: `EmptyState`「現在BB受付中・受付前で条件一致の銘柄はありません」

---

## 8. 詳細ページのセクション順再設計

投資家フロー①〜④の順（`IpoDetailClient.tsx` 変更、**integration タスク**が最終結線。個別コンポーネントは detail タスクが新設/拡張し、`IpoDetailClient.tsx` への差し込みのみ integration が行う）。

| 順 | セクション | 状態 | 対応フロー |
|---|---|---|---|
| 1 | ヘッダー | 既存維持 | — |
| 2 | 価格（`PriceCard`。§9でローソク足を内包） | 既存維持＋拡張 | ④の一部 |
| 3 | **類似条件の初値実績**（`OutcomeDistribution`、新規） | 新規追加 | ③ |
| 4 | スコア（4ゲージ: 需給・ファンダ・**BB参加**（新規）・総合） | 既存＋BB軸追加 | ①③ |
| 5 | スコア内訳（`<details>` 3種→4種） | 既存＋拡張 | ①③ |
| 6 | 基本情報（`BasicInfoList`） | 既存維持 | ①② |
| 7 | **幹事団と申込優先順位**（新規） | 新規追加 | ② |
| 8 | 日程（`Timeline`） | 既存維持 | ①④ |
| 9 | BB申込状況（`BbStatusList`） | 既存維持 | ② |
| 10 | 投資判断チェックリスト | 既存維持 | ①④ |
| 11 | 類似IPO（`SimilarIpos`、既存・手動指定） | 既存維持 | ③の補助 |
| 12 | メモ | 既存維持 | — |

**注**: `IpoDetailClient.tsx` のセクション数が既存10から12に増える。investor案は「実装確実性よりリッチさを優先している」と審査員から指摘されたため、integration タスクは §14 のとおり **新規セクション2つ（`OutcomeDistribution`/`UnderwriterPriority`）は detail タスクが完成品コンポーネントとして納品し、integration は import と配置のみ行う**（ロジックの新規実装をintegration側でしない）ことで統合作業を軽くする。

### 新規セクション「幹事団と申込優先順位」（detail タスク）

`src/components/detail/UnderwriterPriority.tsx`（新規）。§4の `rankBrokersForIpo` をそのまま呼び出し、証券会社ごとの優先順位・配分比率・抽選方式を `ListRow` 形式で列挙する（`/bb` 画面と同じロジックを共有、詳細ページでは全証券会社を常時表示、折りたたみなし）。データが無い場合は「幹事団の配分情報は未取得です。主幹事: {leadUnderwriter}」の1行のみ。

見出し: 「幹事団と申込優先順位」。note: 「幹事配分×抽選方式から算出した参考順位です」

### `IpoDetailClient.tsx` の変更点まとめ（integration タスク）

- import追加: `OutcomeDistribution`, `UnderwriterPriority`
- `scoreBbParticipation` の呼び出し追加（`underwriterBreakEvenStat` を事前計算して渡す）
- `allIpos`・`enriched` を新規propsとして受け取る（`src/app/ipo/[code]/page.tsx` 側で `getAllIpos()`/`getEnrichedByCode(code)` を呼び追加。この1ファイルは既存分担表に無いページなので integration がそのまま担当）
- `ScoreGauges` に4本目のゲージを渡す

---

## 9. セカンダリー分析の深化（自前SVGローソク足）

mvp案の固定335px割り切りを採用。investor案のリッチな参照線設計を統合。

### 9.1 `/api/quote/[code]` の拡張（foundation タスク、既存ファイル変更）

既存レスポンスに `open`/`high`/`low` を追加（**既存フィールド削除なし、追加のみ**）。取得期間はクエリパラメータ `?days=180`（未指定時は既存120日のまま、既存呼び出し元=PriceCardは変更不要）。上限365日でクランプ。

```typescript
export interface QuoteClosePoint {
  date: string;
  open: number | null;   // 追加
  high: number | null;   // 追加
  low: number | null;    // 追加
  close: number;
  volume: number | null;
}
export interface QuoteResponse {
  code: string;
  price: number;
  prevClose: number;
  changePct: number;
  closes: QuoteClosePoint[];
  updatedAt: string;
}
```

`src/lib/quote.ts`（data タスク）: `QuotePoint` に `open?/high?/low?` を追加、`fetchQuote(code, signal?, days?)` に `days` オプション引数を追加（省略時120日で後方互換）。

### 9.2 `src/components/ui/Candlestick.tsx`（新規、foundation タスク）

```typescript
export interface CandlePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * 依存ライブラリなしの自前SVGローソク足チャート。25日移動平均線・出来高バーを併せて描画。
 * @param width 既定335（max-w-lg内の実効幅目安の固定値。ResizeObserver等は使わない＝
 *   MVPでは固定幅で可という判断。より厳密にやりたい場合は将来案として§16に残す）
 * @param height 既定220（出来高バー込みなら+60）
 */
export function Candlestick({
  data, volumes, referenceLines, width = 335, height = 220,
}: {
  data: CandlePoint[];
  volumes?: (number | null)[];
  referenceLines?: { label: string; value: number; tone: "accent" | "accent-2" }[];
  width?: number;
  height?: number;
}): React.ReactElement | null;
```

- `data.length < 2` なら `null`（`Sparkline` と同じ規約）
- 25日移動平均は `computeMovingAverage(closes: number[], window: number): (number | null)[]`（`src/lib/chart/movingAverage.ts`、foundation、テスト対象）。25件未満の区間は描画しない
- 陽線/陰線: `close >= open` で陽線、`--up`/`--down` トークン。出来高バーも同色
- `referenceLines`: 公開価格ライン（`accent-2`）・初値ライン（`accent`）を破線＋ラベルで表示（investor案のUI仕様を踏襲）

### 9.3 `PriceCard` への統合（detail タスク）

既存の `Sparkline`（常時表示の折れ線）はそのまま残す。`determinePhase(ipo, todayIso) === "secondary"` のときのみ `<details><summary>6ヶ月チャート（タップで表示）</summary>` を追加し、開いたときだけ `?days=180` で再fetch（遅延ロード、初期表示のパフォーマンスを保つ）。`referenceLines` には `offeringPrice`/`initialPrice` を渡す。

### 9.4 テスト観点

- `computeMovingAverage`: window未満/ちょうど/超過の境界
- `Candlestick`本体はスナップショットテスト不要（純関数のみテスト、コンポーネントは375px/1280px目視確認で担保）

### 9.5 受け入れ基準

- BB申込・上場当日フェーズの詳細ページでは表示されない
- セカンダリーフェーズかつ日足2件以上ある銘柄でローソク足が表示される
- 375px幅で横スクロール・はみ出しが発生しない
- チャートライブラリが `package.json` に追加されていない（grep確認）

---

## 10. 実装タスク分割（最重要）

### 10.1 原則

mvp案の「並列度の高いレーン構造」を採用しつつ、investor案の詳細な公開インターフェース記述を統合する。共有ファイル（`src/types/*`、`src/lib/merge.ts`、`src/lib/repository.ts`、`package.json`、`wrangler.jsonc`、`src/app/ipo/[code]/page.tsx`、`IpoDetailClient.tsx`、`HomeClient.tsx`、`BbManagerClient.tsx`）は **foundation** または **integration** の単一タスクのみが触る。他タスクは読み取り専用で参照し、変更が必要な場合は自分の成果物末尾に「integrationへの変更依頼」としてコード差分を書き残す（直接編集しない）。

**投資家/data案が3ラウンド共通で指摘された「9タスクがほぼ直列待ち」問題を避けるため、依存なしで即着手可能なタスクを5つ用意し（mvp案の構造）、統合フェーズは1つに絞る**。`BottomTabBar.tsx` の変更は行わない（§0の方針）ため、investor案最大のボトルネック要因（5→6タブ変更をintegration待ちにする問題）は解消済み。

### 10.2 タスク一覧

| タスクID | 担当節 | 触ってよいファイル | 他タスクへ公開するインターフェース | 依存順 |
|---|---|---|---|---|
| **foundation-p2** | §1.3-1.4（型・merge基盤）、§5.2（date.ts）、§9.1-9.2（quote API拡張・Candlestick） | `src/types/enriched.ts`（新規）／`src/lib/merge.ts`（`mergeIpos`第3引数追加・`applyEnriched`）／`src/lib/repository.ts`（enriched読込・`getEnrichedByCode`）／`src/lib/date.ts`（新規、`addDaysIso`/`daysBetween`）／`src/app/api/quote/[code]/route.ts`（OHLCV拡張・daysパラメータ）／`src/components/ui/Candlestick.tsx`（新規）／`src/lib/chart/movingAverage.ts`（新規+test）／`public/sw.js`（push追記部分を除く基本部分） | `IpoEnriched`型、`mergeIpos(base,auto,enriched?)`、`applyEnriched`、`getEnrichedByCode`、`addDaysIso`/`daysBetween`、quote APIの新レスポンス形、`Candlestick`コンポーネント、`computeMovingAverage` | 0（最初。他の全タスクがこれらの型に依存する可能性がある） |
| **data-p2** | §1.5（enrichスクリプト）、§9.1（quote型） | `scripts/enrich/*`（新規一式）／`public/data/ipos.enriched.json`（新規）／`src/lib/quote.ts`（OHLCV型追加・days引数） | `parse96utArticle`, `detectStructureChange`, `collectAllIpoArticleUrls`, `normalizeToMillionYen`, 拡張済み`QuoteResponse`/`QuotePoint` | 1（foundation-p2の`IpoEnriched`型が必要。ただし型は本設計書で確定済みなので実質並行着手可） |
| **stats-p2** | §2 | `src/lib/stats/*`（新規一式） | `outcomeDistributionByAbsorptionBand`, `underwriterBreakEvenStat(s)`, `offeringRatioBandStats`, 各Band型・ラベル | 0（既存`Ipo`型のみ依存。並列可） |
| **scoring-p2** | §3 | `src/lib/scoring/bb.ts`, `.test.ts`（新規のみ。既存`scoring/*`読み取り専用）／`scratch/backtest/recalibrate_bb.py`（新規） | `scoreBbParticipation`, `BbScoreResult`, `DEFAULT_BB_WEIGHTS`, `BB_SCORE_ITEM_LABELS` | 1（stats-p2の`UnderwriterBreakEvenStat`型待ち。型のみなので早期着手可、バックテスト実行はstats完了後） |
| **events-p2** | §5 | `src/lib/events/*`（新規一式）／`src/app/events/page.tsx`（新規）／`src/components/events/*`（新規） | `upcomingCalendarEvents`, `CalendarEvent`, `CALENDAR_EVENT_LABELS` | 1（foundation-p2の`date.ts`待ち。それ以外は並列可） |
| **bb-p2** | §4 | `src/lib/bb/*`（新規一式）／`src/components/bb/BrokerPriorityList.tsx`／`src/components/bb/FundLockCalendar.tsx`／`src/components/bb/BbIpoCard.tsx`（拡張）／`src/components/BbManagerClient.tsx`（自タスクの担当範囲として直接変更してよい＝既存 `mobile-design.md` でbb担当の既存ファイル） | `rankBrokersForIpo`, `buildFundLockPeriods`, `groupOverlappingLocks`, `LOTTERY_TYPE_LABELS` | 2（foundation-p2の`IpoEnriched`型、scoring-p2のBBスコア型待ち。UIコンポーネントは先行着手し、結線のみ後で行う） |
| **push-p2** | §6 | `src/lib/push/*`（新規一式）／`src/app/api/push/*`（新規）／`src/components/settings/PushOptIn.tsx`（新規）／`src/hooks/usePushSubscription.ts`（新規）／`worker/*`（新規）／`public/sw.js`のpush関連追記のみ | `PushSubscriberRecord`, `selectNotifiableEvents`, VAPID関連関数 | **foundation-p2の`public/sw.js`基本部分完了後**（同一ファイル追記のため）。それ以外は events-p2 の型（通知対象イベント選定用）待ちだが型は本書で確定済みのため並行着手可 |
| **detail-p2** | §2 UI, §3 UI, §4 UI（詳細ページ分）, §8, §9.3 | `src/components/detail/OutcomeDistribution.tsx`（新規）／`src/components/detail/UnderwriterPriority.tsx`（新規）／`src/components/detail/ScoreGauges.tsx`（既存拡張）／`src/components/detail/PriceCard.tsx`（既存拡張） | 完成品コンポーネント一式（importして配置するだけで済む形で納品） | 3（stats-p2, scoring-p2, bb-p2, foundation-p2 の型待ち。実装は型さえ確定していれば並行着手可、動作確認は依存タスク完了後） |
| **home-p2** | §7 | `src/components/home/BbCandidates.tsx`（新規）／`src/lib/home/index.ts`（`topBbCandidates`追加、既存拡張） | `topBbCandidates`, `BbHighlightItem` | 1（scoring-p2の型待ち。型は確定済みなので並行着手可） |
| **integration-p2** | 横断結線 | `src/components/IpoDetailClient.tsx`／`src/components/home/HomeClient.tsx`／`src/app/ipo/[code]/page.tsx`／`wrangler.jsonc`／`package.json`（依存追加の最終反映） | — | 4（最後。全タスク完了後にまとめて配線） |

### 10.3 依存順の要約（レーン図）

```
着手可能（依存なし、型は本書で確定済みのため実質フルスクラッチで並行着手可）:
  foundation-p2, stats-p2, data-p2（enriched型定義は本書確定のため）

foundation-p2 完了後（public/sw.js基本部分・date.ts）:
  events-p2, push-p2（sw.js追記部分）

stats-p2 完了後（型は確定済みなので実装は並行、バックテスト実行のみ待ち）:
  scoring-p2

scoring-p2 完了後:
  bb-p2, home-p2, detail-p2（BB参加スコア表示部分）

data-p2, foundation-p2 完了後:
  detail-p2（ローソク足・OutcomeDistribution）

全タスク完了後、最後:
  integration-p2（型配線・IpoDetailClient/HomeClient結線・wrangler設定・最終ビルド確認）
```

実務上は「foundation-p2・stats-p2・data-p2 を最初に並列着手」→「scoring-p2・events-p2 を次に並列着手」→「bb-p2・home-p2・push-p2・detail-p2 を並列着手」→「integration-p2」の4波で進める（investor案の5波・9タスク直列待ちより並列度が高く、mvp案と同等の完遂確実性を持つ）。

### 10.4 タスクごとの完了定義（Definition of Done）

- 新規追加した純関数はすべてテスト付き（`npx vitest run <対象ファイル>` が通過）
- `npx tsc --noEmit` が自分の変更ファイル範囲でエラーを出さない（他タスク未着手ファイルへの参照で発生するエラーは許容し、コメントで「〇〇タスク完了後に解消見込み」と明記してよい）
- 公開インターフェース（上表）は設計書記載のシグネチャと一致させる
- 共有ファイルへの変更が必要になった場合は直接編集せず、integration-p2への変更依頼として成果物末尾にコード差分を書き残す

### 10.5 各タスクの受け入れ基準（テスト名・件数の目安）

| タスク | テストファイル | 目安件数 |
|---|---|---|
| foundation-p2 | `src/lib/merge.test.ts`(既存拡張)、`src/lib/date.test.ts`、`src/lib/chart/movingAverage.test.ts` | 既存+8件、6件、5件 |
| data-p2 | `scripts/enrich/parse96ut.test.ts` | 15件以上（フィクスチャ5種×主要フィールド） |
| stats-p2 | `src/lib/stats/stats.test.ts` | 12件以上（帯境界・母数0・中央値偶奇） |
| scoring-p2 | `src/lib/scoring/bb.test.ts` | 10件以上（境界値・unknown処理・ゼロ除算回避） |
| events-p2 | `src/lib/events/events.test.ts` | 8件以上 |
| bb-p2 | `src/lib/bb/priority.test.ts`, `fundLock.test.ts` | 各6件以上 |
| push-p2 | `src/lib/push/notify.test.ts` | 6件以上 |
| home-p2 | `src/lib/home/home.test.ts`(既存拡張) | +3件 |
| detail-p2 | なし必須（末端UIのため。375px/1280px目視確認で担保） | — |
| integration-p2 | 全体の `npm test`／`npx tsc --noEmit`／`npm run build` | 既存154件＋新規追加分すべて通過 |

---

## 11. 納品ゲート

`scratch/mobile-design.md` §8（基本ゲート）に加え、Phase 2 固有分:

1. `npx tsc --noEmit` エラー0 / `npm run lint` エラー0 / `npm test` 全通過（既存154件＋新規追加分） / `npm run build` 成功
2. custom worker構成（`main`変更後）でも `npm run build`（`opennextjs-cloudflare build`）が成功する
3. `npm run preview`（Wranglerローカル）でKVバインディング・quote API拡張・Cron設定（手動実行）が解決できることを確認
4. 375px・1280pxで全ルート（既存7ルート＋新規 `/events`、詳細ページの6ヶ月チャート展開状態・`/bb`の資金拘束カレンダー表示状態を含む）の `document.documentElement.scrollWidth <= window.innerWidth`
5. ボトムタブは既存5つのまま、各リンク高さ≥44px、`aria-current="page"`維持（タブ数は変更しない）
6. `/manifest.webmanifest` `/sw.js` `/icons/icon-192.png` `/icons/icon-512.png` `/apple-touch-icon.png` が200
7. 禁止語grep（`scratch/mobile-design.md`§6・context.md記載の10語）が `src/` 配下でゼロ。96utから取り込んだ主観評価文言（「初値予想」「BB参加姿勢」等）が `IpoEnriched`/`Ipo` のどのフィールドにも入っていないこと
8. `git diff --stat public/data/ipos.base.json public/data/ipos.auto.json` で既存2ファイルが変更されていないこと（enrichedは新規ファイルとして追加のみ）
9. localStorageキーが既存5つ（`settings:v2`/`watchlist:v1`/`bb:v1`/`notes:v1`/`theme:v1`）から増えていないこと（プッシュ購読状態はKV管理でlocalStorageを使わない設計のため増分なしを基本とし、もし増える場合は `ipo-analyzer:<name>:v1` 形式であることと本人へ報告する）
10. 既存ファイルの削除なし
11. enrichedデータを持つ全レコードに `sources` が最低1件入っている
12. `scratch/backtest/report-phase2.md` が存在し、BB参加スコアの重み検証結果（改善の有無とその根拠）が記録されている
13. 依存追加は「Web Push関連1つ（検証NGなら0）」のみ（それ以外の新規npm依存ゼロ）。`package.json` のdiffで確認
14. チャートライブラリが追加されていない（`package.json` grep）
15. 投資家フロー①〜④が画面遷移なしで追える動線になっている（ホーム→詳細で①③が見える、`/bb`で②が見える、`/events`と通知で④が見える）
16. 96ut補完後、JPX発見銘柄40件のうち `insufficient` のままの件数が減っている（96utに記事が存在しない銘柄は仕方なく残る。0件化は目標にしない）
17. `scripts/enrich/parse96ut.test.ts` がフィクスチャHTML5種（正常2・仮条件未発表1・表記揺れ1・構造変更1）で通過する
18. Cloudflareの有料機能（Durable Objects課金枠超過、R2、Queues等）を使わない。KV（無料枠内）とCron Triggers（無料枠内、1日1回）のみ許容

---

## 12. 将来案メモ（Phase 2 スコープ外、本人判断待ち）

**クラウド同期（Cloudflare D1）**: 現状 localStorage 完結のユーザーデータ（ウォッチ・BB状況・メモ）を複数端末間で同期したい場合、D1（SQLite互換、無料枠あり）に移行する案がある。ただし認証機構（誰のデータか識別する仕組み）が新たに必要になり、個人用ツールの現在のシンプルさを大きく損なう。本人が「複数端末で使いたい」と明確に感じたタイミングで再検討するのがよく、Phase 2 では手を付けない。

**ネイティブ化（Capacitor `cap add ios/android`）**: `capacitor.config.ts` の準備は Phase 1 で完了済み。実際の `cap add` には Xcode/Android Studio のローカル環境が要り、ストア公開には開発者登録・審査対応も伴う。PWA（ホーム画面追加）で通知含め大半の体験が賄える現状、ネイティブ化の優先度は低い。ネイティブプッシュ通知（APNs経由）はWeb Pushと別実装が必要になる点も判断材料。本人が「オフラインでの安定動作」「ストア経由の配布」を明確に必要とした時点で着手するのがよい。

**M1夜間ジョブ化**: `npm run update:data`・`npm run enrich:data` を毎日決まった時刻に自動実行したい場合、既存の m1-server 運用（`~/.claude/rules/m1-server.md`、`m1-ops` Skill）に乗せる形が自然。Cloudflare Cron（§6のプッシュ通知用に導入済み）に同居させる案もあるが、JPX/96ut/Yahoo Financeへのスクレイピングは実行時間が数分単位でCronの実行時間制限（Workers無料枠は1回あたりのCPU時間に上限あり）に収まらない可能性があるため、データ取得系はM1（自前サーバー、時間制限なし）で回し続け、Cronは「軽量な通知送信のみ」に役割を絞るのが安全。本人の運用希望（M1常時稼働の可否）を確認してから着手する。

**ボトムタブ6化・月表示カレンダーグリッド**: 本書ではタブは5つのまま据え置き、イベントカレンダーはリンク導線で発見してもらう設計にした。実際に運用してみて「イベント一覧が発見されにくい」と感じた場合は、タブを6つに増やす変更（375px幅での再検証込み）を独立したPRとして着手するのがよい。同様に、抽選日・購入期限の月表示カレンダーグリッド（CSS Grid実装）も、一覧表示で運用してみて不便を感じた場合の拡張候補として残す。

---

以上。
