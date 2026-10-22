# Apollo IPO を Cloudflare にデプロイする計画（2026-09-25 時点調査）

調査対象: `/Users/kazukiyoshida/ipo-analyzer`（Next.js 16.2.10 / React 19.2.4 / App Router / Turbopack / TypeScript、`yahoo-finance2` を使う Route Handler、ISR、181 ページ SSG、PWA）

---

## 結論（推奨構成）

- **アダプター**: `@opennextjs/cloudflare`（Cloudflare Workers 向け）を使う。これが2026年9月時点のCloudflare公式のNext.js推奨経路。
  - Cloudflare公式ドキュメントでは新しい `vinext`（Vite上でNext.js APIを再実装したもの、2026年2月ベータ開始）が「Cloudflare Workers上でNext.jsを動かす既定の方法」として案内されているが、**まだベータであり互換性チェック（`npx vinext check`）を事前に通すことを公式自身が推奨している**。本アプリは `yahoo-finance2`・ISR・generateStaticParamsでの181ページSSG・カスタムService Workerなど枯れた機能中心の構成のため、実績のある `@opennextjs/cloudflare`（1.x、GA済み）を第一選択とし、vinextは様子見が安全という判断（推測: vinextはNext.js 16 APIの94%カバーとされ、本アプリの構成なら動く可能性は高いが「確認できず」）。
  - `@cloudflare/next-on-pages`（Pages向け旧アダプター）はCloudflare公式が「superseded（後継に取って代わられた）」と明記しており、新規採用は推奨されない。
- **ISR incremental cache**: 無料枠に収めるため **Workers Static Assets を incremental cache に使う「zero-infrastructure」構成**を推奨。
  - `/`（revalidate 300）と `/api/quote/[code]`（revalidate 600）は「ビルド時点の値を返す静的キャッシュ」になり、`revalidateTag`/`revalidatePath`による明示的な再検証はできない（後述「リスク」参照）。
  - R2（無料枠: 10GB-month・Class A 100万回/月・Class B 1000万回/月・egress無料）を使えばISRの本来の「時間経過での自動再生成」に近い動きにできるが、R2バケット作成という追加セットアップが要る。個人用ツールでデータ更新は`npm run update:data`＋再デプロイで足りるため、**まずはStatic Assetsキャッシュで十分**というのが今回の推奨。
- **公開先**: `*.workers.dev` サブドメインで無料公開可能。カスタムドメイン不要。
- **デプロイ方式**: 最初は手動デプロイ（`wrangler login` は本人のブラウザOAuth操作が必要）→ 安定したら Cloudflare Dashboard の「Workers Builds」でGitHub連携し、`main` push時に自動デプロイへ切り替え（無料枠: 3,000ビルド分/月・同時1ビルド）。

---

## 必要ファイルの完全な中身（コピペ可能）

### 1. `wrangler.jsonc`（新規作成）

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "apollo-ipo",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-09-25",
  "compatibility_flags": [
    "nodejs_compat",
    "global_fetch_strictly_public"
  ],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "services": [
    {
      "binding": "WORKER_SELF_REFERENCE",
      "service": "apollo-ipo"
    }
  ]
  // R2をISRキャッシュに使う場合のみ有効化（今回はStatic Assetsキャッシュ採用のため未使用）:
  // "r2_buckets": [
  //   { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "apollo-ipo-cache" }
  // ]
}
```

補足: `compatibility_date` はデプロイ実行日（本人操作時点の日付）に合わせる。公式サンプルは `"2024-12-30"` 以降を推奨としている。

### 2. `open-next.config.ts`（新規作成。リポジトリルート）

```typescript
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// 無料枠で完結させる構成。ISRの再検証（revalidateTag/revalidatePath）は使わず、
// ビルド時点のプリレンダー結果をそのまま配信する「zero-infrastructure」キャッシュ。
// データを更新したい場合は `npm run update:data` → 再デプロイで反映する運用にする。
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
```

### 3. `next.config.ts`（既存ファイルへの追記が必要）

```typescript
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// ローカル `next dev` でCloudflare bindings（ASSETS等）を使えるようにする。
// 本番ビルド・デプロイには影響しない（開発体験の補助）。
initOpenNextCloudflareForDev();
```

### 4. `package.json` の scripts 追加分

```json
{
  "scripts": {
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"
  }
}
```
既存の `build`/`dev`/`start`/`lint`/`test`/`update:data`/`cap:*` はそのまま残す。

追加が必要な依存（devDependencies）:
```bash
npm install --save-dev @opennextjs/cloudflare@latest wrangler@latest
```
2026-09-25時点で確認できた最新バージョン: `@opennextjs/cloudflare` は npm検索経由で `1.20.6`（22日前公開、と検索結果に表示）。`wrangler` は検索結果内で `4.128.0`〜`4.137.0` の表記が混在し確定できなかった（下記「確認できなかった項目」参照）。いずれも `@latest` 指定でインストールすれば実際に手を動かす時点の最新版が入るため、バージョン固定は不要。

### 5. `.gitignore` への追加

```
.open-next
.wrangler
cloudflare-env.d.ts
```

### 6. `.dev.vars`（ローカル開発用、`.gitignore`対象・コミットしない）

```
NEXTJS_ENV=development
```

---

## 手順（本人がやる操作 / AIが代行できる操作）

### 本人がブラウザで行う操作（AI代行不可）
1. Cloudflareアカウント作成（未作成の場合）。
2. `npx wrangler login` を実行 → 自動的にブラウザが開き、Cloudflareアカウントでログイン・許可（OAuth、`localhost:8976`でコールバックを受ける）。ヘッドレス環境等でブラウザが開けない場合は `wrangler login --device` でデバイス認可コードを使う代替フローがある。
3. （GitHub連携で自動デプロイにする場合）Cloudflare Dashboard →「Workers & Pages」→「Create application」→「Import a repository」からGitHubアカウントを接続し、対象リポジトリを選択・許可。

### AIが代行できる操作
1. `npm install --save-dev @opennextjs/cloudflare@latest wrangler@latest` の実行。
2. `wrangler.jsonc` / `open-next.config.ts` の作成、`next.config.ts` への `initOpenNextCloudflareForDev()` 追記、`package.json` scripts追加、`.gitignore` 追記。
3. （本人が`wrangler login`済みの前提で）`npm run deploy`（内部で `opennextjs-cloudflare build && opennextjs-cloudflare deploy` を実行）。これで `.open-next/` ビルド → Cloudflareへアップロード → `https://apollo-ipo.<本人のworkers.devサブドメイン>.workers.dev` のようなURLが発行される。
4. ローカルでのプレビュー確認: `npm run preview`（Workers runtime相当のローカル環境で動作確認、実際のCloudflareへはデプロイしない）。
5. GitHub連携後の自動デプロイ設定自体は「本人がダッシュボードでリポジトリを選ぶ」操作が要るが、連携完了後の`main`への通常のgit pushはAIが代行してよい（デプロイトリガーは自動）。

### 移行時に既存ファイルへ加える変更のまとめ
- `next.config.ts`: `initOpenNextCloudflareForDev()` の呼び出しを追加（上記）。
- `export const runtime = "edge"` を使っている箇所があれば削除する必要があるが、本アプリの `src/app/api/quote/[code]/route.ts` を確認した限り `runtime = "edge"` の指定は無い（Node.js runtimeが暗黙のデフォルト）。`@opennextjs/cloudflare` はNode.js runtimeを前提にする設計なので、このままで問題ない。
- 他のNext.jsのソースコード（`page.tsx`, `repository.ts`, `route.ts` 等）は変更不要と判断（推測ではなく、公式Get Startedの手動セットアップ手順に「既存コードの書き換え」は含まれておらず、edge runtime削除以外の要求は無かったことに基づく）。

---

## 無料枠の見積り

| リソース | Workers Free の上限 | 本アプリでの見積り | 収まるか |
|---|---|---|---|
| リクエスト数 | 100,000/日 | 個人利用のみ、日100リクエスト未満と推測 | 収まる |
| CPU時間 | 10ms/リクエスト（invocation単位、日次総量制限ではない） | ページ生成はISR/SSGで大半が静的配信、`/api/quote/[code]`のyahoo-finance2呼び出しはfetch待ち時間がCPU時間に含まれないため軽い可能性が高い（推測: 実測は要検証） | 収まる可能性が高いが未実測 |
| Workerサイズ | 64MiB（2026年9月の変更で旧3MB/10MB圧縮上限は撤廃） | `public/data/*.json` 合計約244KB＋181ページ分のプリレンダーHTML。Next.jsのSSGビルド出力は数MB程度になる見込み（推測: 本アプリ規模なら数MB〜十数MB） | 十分収まる |
| 静的アセットファイル数 | 20,000ファイル/Workerバージョン（Free） | 181銘柄ページ×（HTML＋関連チャンク）＋共通アセット。数百〜数千ファイル程度と推測 | 収まる見込み |
| 静的アセット個別ファイルサイズ | 25MiB/ファイル | JSON最大188KB（ipos.base.json） | 十分収まる |
| サブリクエスト数 | 50/request | `/api/quote/[code]`はyahoo-finance2経由で1〜数リクエスト | 収まる |
| Workers Builds（GitHub連携時） | 3,000ビルド分/月・同時1ビルド | 個人の更新頻度なら十分 | 収まる |
| R2（ISRキャッシュに使う場合のみ） | 10GB-month・Class A 100万回/月・Class B 1000万回/月・egress無料 | 今回はStatic Assetsキャッシュ採用のため未使用 | （不使用） |

現状のリポジトリの `public/data/` 合計は `ipos.base.json` 188KB + `ipos.auto.json` 16KB + `market.json` 4KB = 約208KB（実測）。Node.jsは v22.22.3（実測、本人環境）。

---

## リスク・非対応

1. **ISRの「時間経過での自動再生成」は今回の構成（Static Assetsキャッシュ）では機能しない**。公式ドキュメントに「read-only store」「serving build-time values」「Revalidation is not supported with this cache」と明記されている。つまり `revalidate: 300`（ホーム）・`revalidate: 600`（quote API）・`repository.ts`内の`REVALIDATE_SECONDS`は**Workers上ではビルド時点の値を返し続け、指定した秒数が経過しても自動では再生成されない**。データを更新したいときは再デプロイが必要になる。
   - `open-next.config.ts`で明示的に何もキャッシュを指定しない場合（`defineCloudflareConfig()`のみ）の挙動は、公式ドキュメント（`opennext.js.org/cloudflare/caching`）内に明記を見つけられず「確認できず」。二次情報（個人ブログ`davidloor.com`）では「デフォルトはDurable Objectsベースの`DOShardedTagCache`/`BucketCachePurge`/`DOQueueHandler`が有効になり、呼び出しごとに課金が発生する」との記述があったが、これは公式一次情報で裏取りできていないため参考情報止まりとする。**無料枠に確実に収めるには、本レポート推奨のStatic Assetsキャッシュを明示的に指定するのが安全。**
2. **`/api/quote/[code]` は動的なRoute Handler**（`revalidate = 600`指定だが実質はキャッシュされないリクエストごとの実行、または上記と同じ理由でビルド時点固定になる可能性）。ライブ株価取得という用途上、本来は毎回最新を取りたい機能のため、Static Assetsキャッシュ構成だとこのAPIの挙動が意図と食い違う可能性がある。**要検証**（デプロイ後の実機確認を推奨）。
3. **`yahoo-finance2` のCloudflare Workers対応**: 公式GitHub（`github.com/gadicc/yahoo-finance2`）に「Cloudflare: Modern releases, tested in CI via Workers Vitest under `nodejs_compat`」と明記されており、`nodejs_compat`フラグ有効時に動作確認済みという一次情報が取れた。`wrangler.jsonc`に`nodejs_compat`を含めているため対応済みという想定で問題ない。
4. **Node Middleware（Next.js 15.2以降の機能）は`@opennextjs/cloudflare`で未サポート**と公式ドキュメントに明記。本アプリに`middleware.ts`があるかは未確認（今回の調査対象ファイル一覧に含まれていなかったため）。存在する場合は要注意。
5. **PWA Service Worker（`public/sw.js`）**: Cloudflareの静的アセット配信に乗せてそのまま`/sw.js`として配信されるはずだが、Workers Assetsのキャッシュヘッダ挙動がVercel/Streamlitと異なる可能性があり、実機での動作確認（インストール・オフラインフォールバック）を推奨。
6. **Streamlit Cloudからの移行という文脈について**: 現状の`README.md`には「Vercelにそのままデプロイできます」という記述があり、指示にあった「既存のStreamlit Cloud（streamlit.app）アプリからの移行」に該当する現行デプロイ先の記述は見つからなかった（`scratch/streamlit-app.py`は旧バージョンの名残と推測）。**Streamlit Cloud上の現行URLは確認できず**。仮にstreamlit.appのURLが本番として稼働中であれば、Cloudflare移行時に以下は要注意（一般的なWeb技術知識に基づく判断であり、Cloudflare固有の一次情報での確認ではない）:
   - URLが`*.streamlit.app`から`*.workers.dev`（またはカスタムドメイン）に変わるため、ブックマーク・ホーム画面ショートカット・共有リンクの差し替えが必要。
   - PWAのService Worker（`public/sw.js`）はオリジン単位でスコープが決まるため、新URLでは再インストール（ホーム画面への再追加）が必要になり、旧URLでインストールされたPWAは自動では移行されない。
   - Capacitorを使う場合、`capacitor.config.ts`の`CAP_SERVER_URL`環境変数を新しいCloudflare URLに変更する必要がある（現状は未設定時`webDir: "out"`にフォールバックする設計）。

---

## 出典URL一覧

- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/（Cloudflare公式：vinextが現在の推奨パスと明記。ベータであり`npx vinext check`推奨も明記）
- https://opennext.js.org/cloudflare （OpenNext公式トップ：Next.js 16対応、Node Middleware未サポート、next-on-pagesがsupersededと明記）
- https://opennext.js.org/cloudflare/get-started （wrangler.jsonc・open-next.config.ts・package.json scripts・.gitignoreのサンプル、既存プロジェクトへの導入13ステップ、`npx @opennextjs/cloudflare migrate`コマンド）
- https://opennext.js.org/cloudflare/caching （incrementalCacheの3方式：R2/KV/Static Assets。Static Assetsは「read-only」「revalidation非対応」と明記）
- https://developers.cloudflare.com/workers/platform/limits/ （Workers Free上限：リクエスト数10万/日、CPU時間10ms/invocation、メモリ128MB、Workerサイズ64MiB、静的アセット2万ファイル/25MiBファイルサイズ、サブリクエスト50/request等）
- https://developers.cloudflare.com/workers/platform/pricing/ （Free plan概要の再確認）
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ （Workers Builds無料枠：3,000分/月・同時1ビルド）
- https://developers.cloudflare.com/workers/ci-cd/builds/ （GitHub/GitLab連携手順：Import a repository→Save and Deploy→push時自動デプロイ）
- https://developers.cloudflare.com/workers/wrangler/commands/general/ （`wrangler login`のOAuthフロー、`--device`フラグ）
- https://github.com/gadicc/yahoo-finance2 （Cloudflare Workers対応：Workers Vitest下`nodejs_compat`でテスト済みと明記）
- https://developers.cloudflare.com/r2/pricing/ （R2無料枠：10GB-month、Class A 100万/月、Class B 1000万/月、egress無料）
- https://github.com/opennextjs/opennextjs-cloudflare （OpenNext Cloudflareアダプター本体リポジトリ。詳細はopennext.js.org側に案内、との記載のみ確認）

補足（検索結果の要約のみで一次ページの直接確認ができなかったもの。参考情報扱い）:
- Next.js 16対応・vinext詳細の経緯: WebSearchの要約（nextjs.org/blog/nextjs-across-platforms、cloudflare公式ブログ等が言及元とされるが個別ページは直接WebFetchしていない）
- `@opennextjs/cloudflare`最新版`1.20.6`、`wrangler`最新版（`4.128.0`〜`4.137.0`の表記が混在）: npmjs.comのページ自体はWebFetchで403エラーとなり直接確認できず、WebSearchのスニペット要約に基づく。
- Static Assetsキャッシュ非設定時のDurable Objectsデフォルト挙動: davidloor.comの個人ブログ記事に基づく二次情報（一次情報での裏取りできず）。

---

## 確認できなかった項目

- `wrangler`パッケージの2026-09-25時点での確定バージョン番号（npmjs.comページがWebFetchで403 Forbiddenとなり直接確認できず。検索結果内で`4.128.0`と`4.137.0`の表記が混在し確定できなかった。実運用では`wrangler@latest`指定でインストールすれば問題ない）。
- `open-next.config.ts`で何もキャッシュ方式を指定しない場合（デフォルト）の一次情報での正確な挙動（公式`caching`ページ内に明記を発見できず）。
- `/api/quote/[code]`のようなAPI Route HandlerがStatic Assetsキャッシュ構成下で実際にどう動くか（ビルド時固定か、リクエストごとに実行されるか）の一次情報での確定。デプロイ後の実機確認が必要。
- 本アプリに`middleware.ts`が存在するかどうか（今回の調査対象ファイルに含まれておらず未確認。存在すれば`@opennextjs/cloudflare`のNode Middleware非対応に抵触する可能性）。
- 現在Streamlit Cloud（`*.streamlit.app`）上でApollo IPOが実際に稼働中かどうか、稼働中URLそのもの（README記載は「Vercelにそのままデプロイできます」であり、streamlit.app稼働の直接的な確認は取れず）。
- Cloudflare Workers Free plan の「CPU時間10ms/invocation」が本アプリの実運用（181ページSSG配信・yahoo-finance2呼び出し）で実際に十分か（fetch待ち時間はCPU時間に含まれないとされるが、実測での検証はしていない）。
