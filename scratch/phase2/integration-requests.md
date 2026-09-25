# 各タスクからの結線依頼（integrationRequests）と notes


## stats-p2

### publicInterfaces
- type AbsorptionBand, classifyAbsorptionBand(n), ABSORPTION_BAND_LABELS
- type OfferingRatioBand, classifyOfferingRatioBand(n), OFFERING_RATIO_BAND_LABELS
- interface OutcomeSample, OutcomeDistributionResult; outcomeDistributionByAbsorptionBand(allIpos, targetIpo)
- interface UnderwriterBreakEvenStat; underwriterBreakEvenStats(allIpos, minSample = 2); underwriterBreakEvenStat(allIpos, underwriter): UnderwriterBreakEvenStat | null
- interface OfferingRatioBandStat; offeringRatioBandStats(allIpos)
- interface MarketStat; marketStats(allIpos): MarketStat[]
- median(values: number[]): number | null

### integrationRequests

### notes
- 帯の境界は上側の帯に含める（吸収金額: <10 under10, 10-<30, 30-<100, >=100 over100 / OR: <10, 10-<30, 30-<50, >=50 over50）。ラベルは「10億円未満」「10〜30億円」「30〜100億円」「100億円以上」、「10%未満」「10〜30%」「30〜50%」「50%以上」。
- absorptionAmount・offeringRatio が 0 以下のものは未取得（merge.ts スケルトンの既定値 0）とみなし帯別集計から外す。target の吸収金額が 0 なら母数0の結果を返す（10億円未満の帯に誤って入れないため）。注意: 現在の ipos.base.json は offeringRatio が全157件とも 0 なので、enriched で補完されるまで offeringRatioBandStats は全帯とも母数0になる。
- winRate は初値>公開価格、breakEvenRate は初値<公開価格（初値＝公開価格はどちらにも入らない）。
- underwriterBreakEvenStats は leadUnderwriter でグループ化し、母数の多い順（同数は名前順）に並べる。UnderwriterBreakEvenStat 型が number のため breakEvenRate/meanReturn は null にせず、母数0の主幹事は結果に含めない（単体版は null を返す）。
- 設計書の関数に加えて median(values) と marketStats(allIpos): MarketStat[]（{market, sampleCount, winRate, medianReturnRate}、3市場を固定順で返す）を export した。
- OutcomeSample.returnRate は format.ts の initialReturnRate をそのまま使う（丸めなし）。

### risks
- 現データでは offeringRatio が全件 0 のため、OR帯の統計は enriched データが merge されるまで空になる。

### unfinished


## foundation-p2

### publicInterfaces
- src/types/enriched.ts: SourceRef, UnderwriterAllocation, MajorShareholder, CompanyProfile, FinancialPeriod, IpoEnriched
- src/lib/merge.ts: applyEnriched(ipo: Ipo, enriched: IpoEnriched | undefined): Ipo; mergeIpos(base: IpoBase[], auto: IpoAuto[], enriched?: IpoEnriched[]): Ipo[]
- src/lib/repository.ts: IpoDataSet { ipos; market; enriched: IpoEnriched[] }; getAllEnriched(): Promise<IpoEnriched[]>; getEnrichedByCode(code): Promise<IpoEnriched | undefined>; findEnriched(all, code): IpoEnriched | undefined
- src/lib/date.ts: addDaysIso(iso: string, days: number): string; daysBetween(fromIso: string, toIso: string): number
- GET /api/quote/[code]?days=N (1..365, default 120): closes[] = { date, open: number|null, high: number|null, low: number|null, close, volume: number|null }; exports types QuoteClosePoint, QuoteResponse
- src/components/ui/Candlestick.tsx: CandlePoint; Candlestick({ data, volumes?, referenceLines?: {label, value, tone: 'accent'|'accent-2'}[], width=335, height=220 })
- src/lib/chart/movingAverage.ts: computeMovingAverage(closes: number[], window: number): (number | null)[]

### integrationRequests

#### src/lib/quote.ts (data-p2 owns this file; it already shows as modified in the tree)

Make QuotePoint match the route: add `open?: number | null; high?: number | null; low?: number | null;`. Build the URL in fetchQuote(code, signal?, days?) as `days ? `/api/quote/${code}?days=${days}` : `/api/quote/${code}``. The route now returns open/high/low as number|null on every point, keeps all existing fields (date/close/volume), accepts ?days= clamped to 1..365, and defaults to 120 days. It also exports `QuoteClosePoint` and `QuoteResponse` types.

#### vitest.config.ts

The include is currently only `src/**/*.test.{ts,tsx}`, so data-p2's scripts/enrich/parse96ut.test.ts will not run under npm test. To pick it up: `include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"]`. Only needed if data-p2 has not already handled this.

#### src/app/ipo/[code]/page.tsx (integration-p2)

`import { getAllIpos, getEnrichedByCode } from "@/lib/repository";` then `const enriched = await getEnrichedByCode(code);` and pass `enriched` to IpoDetailClient. Alternative: call loadIpoData() once, then findEnriched(data.enriched, code) to avoid repeated loads.

### notes
- Public interfaces match design §1.1/§1.3/§1.4/§5.2/§9.1/§9.2. src/types/enriched.ts is copied verbatim from design §1.1.
- mergeIpos(base, auto, enriched?): omitting the 3rd argument or passing [] gives exactly the old result; a test confirms this. A base item with no auto entry is still returned as the same object reference, as before. Processing order is base → applyEnriched → mergeOne(auto). Skeletons from skeletonFromAuto also go through applyEnriched. Enriched codes that appear in neither base nor auto are not added.
- applyEnriched only fills fields while they still hold default values: bbPeriod, allotmentDate, purchasePeriod, publicShares, saleShares, overAllotment, offeringRatio, priceRange, offeringPrice, absorptionAmount, marketCap, underwriters, financials, vcRatio, lockup. It never mutates its input, and returns the input as-is when enriched is undefined. Fill values must be positive finite numbers or non-empty strings/ranges, so a 0 or null from enriched never overwrites anything.
- Added beyond the design table: assumedPrice (fills when base is 0) and leadUnderwriter (fills when base is ""). Both follow the same rule (fill only when base is at its default) and are there so JPX-discovered skeletons get these values filled in. The base CSV data has no rows with either at its default, so existing data is unaffected.
- Where design §1.3 was ambiguous: when priceRange is unset and enriched has no priceRange, the fallback uses enriched.assumedPrice (low=high), not base.assumedPrice. This keeps the acceptance criterion that base defaults stay unchanged when enriched has no data. When offeringRatio is missing it is recalculated as (publicShares+saleShares)/enriched.issuedShares, rounded to 0.1%. That needs issuedShares, which the design does not state explicitly.
- The financials rule follows the design: when revenueGrowth===0, the whole object is replaced. One base record has revenueGrowth=0 but operating profit and isProfitable filled in; if enriched has financials, those will be overwritten too.
- repository.ts: statically imports ipos.enriched.json and casts it `as unknown as IpoEnriched[]`, because an empty array literal is inferred as never[]. When DATA_BASE_URL is set it also fetches ipos.enriched.json remotely, falling back to the bundled file if the result is not an array. Exports added: IpoDataSet.enriched, getAllEnriched(), getEnrichedByCode(code), findEnriched(all, code).
- Candlestick.tsx: plain SVG with no dependencies and no "use client". Returns null when data.length<2. Draws the 25-day MA polyline (--text-muted) with its legend at the bottom centre, so it cannot collide with reference-line labels. Candles and volume bars use --up/--down. Reference lines are dashed in --accent or --accent-2, with labels haloed by stroke=var(--surface). Has role=img and an aria-label, and uses tabular-nums. It keeps the viewBox aspect ratio via width attr + className "block h-auto max-w-full". A headless Chrome render at 375px and 300px viewports showed no horizontal overflow.
- The route's QuoteResponse keeps the existing price/prevClose/changePct types (number|null). The design lists them as number, but they were left as-is so no existing field changes. It adds a module-private parseLookbackDays(), which is not exported because Next's route-export checks would reject it.
- No new dependencies. Formatting used `npx prettier`, which is not a project dependency: npx pulled it into the global npx cache only. Neither package.json nor node_modules changed.
- src/lib/checklist/items.ts still has private daysBetween/addDaysIso with the same behaviour as src/lib/date.ts. Per the design (§5.2) the checklist is left unchanged.

### risks
- When data-p2 fills ipos.enriched.json, applyEnriched fills in the JPX-discovered stocks. Their completeness level will then change (insufficient → partial or above), which also changes what the UI shows. This is intended.
- Adding "/events" to APP_SHELL before the /events page exists is harmless: sw.js uses a per-URL catch, so the install does not fail.
- Because the route now reads request.url, it is dynamic. It already depended on dynamic params, so revalidate=600 should behave the same in practice, but this is unconfirmed until integration's build/preview.

### unfinished


## events-p2

### publicInterfaces
- upcomingCalendarEvents(ipos: Ipo[], todayIso: string, days?: number): CalendarEvent[]
- recentLargeHoldingReports(ipos: Ipo[], todayIso: string, withinDays?: number): CalendarEvent[]
- lockupExpiryEvent(ipo: Ipo, todayIso: string): CalendarEvent | null
- priceReleaseWatchEvent(ipo: Ipo, todayIso: string): CalendarEvent | null
- firstEarningsEvent(ipo: Ipo): CalendarEvent | null
- groupEventsByDate(events: CalendarEvent[]): { date: string; events: CalendarEvent[] }[]
- CALENDAR_EVENT_LABELS: Record<CalendarEventKind, string>
- type CalendarEventKind, interface CalendarEvent（src/lib/events/index.ts）
- EventsClient({ ipos, todayIso }) / EventListItem({ event })
- route /events

### integrationRequests

### notes
- src/lib/date.ts（foundation-p2）が既にあったため、addDaysIso/daysBetween はそこから import した。ローカルの暫定実装は置いていない。
- 公開インターフェースは設計書 §5.2 のシグネチャどおり: CalendarEventKind, CalendarEvent, CALENDAR_EVENT_LABELS, upcomingCalendarEvents(ipos, todayIso, days=90), lockupExpiryEvent(ipo, todayIso), priceReleaseWatchEvent(ipo, todayIso), firstEarningsEvent(ipo), recentLargeHoldingReports(ipos, todayIso, withinDays=30)。UI の日付グルーピング用に groupEventsByDate(events) を追加した。
- upcomingCalendarEvents の対象範囲は [today, today+days]（両端含む）で、既存 home の upcomingEvents と同じ。日付昇順で、同じ日付は種別順（BB開始→BB締切→抽選→購入開始→購入期限→上場→ロック解除→1.5倍監視→初決算）、その次にコード順。home の4種に bbEnd と purchaseEnd（購入期限）を加えた。§4 の『抽選日・購入期限』に合わせるためで、home 側は変更していない。
- lockupExpiryEvent: lockup.days>0 かつ listingDate ありのときだけ生成し、解除日は listingDate+days（checklist の checkLockupExpiry と同じ計算）。解除日が今日より前なら null。
- priceReleaseWatchEvent: 条件は hasPriceRelease、offeringPrice>0、currentPrice ありで、currentPrice >= offeringPrice*1.4（境界を含む）。1.5倍以上なら detail を『到達圏』、1.4〜1.5倍なら『接近』とする（checklist の checkPriceReleaseLine と同じ基準）。date は todayIso。設計書にない追加判断として、ロックアップ期間が終わった銘柄は価格解除条項に意味がないので除外した。
- recentLargeHoldingReports は『新着』枠のため新しい順（日付降順）にした。対象は提出日が [today-30, today] の範囲（両端含む）で、未来日付は除外する。
- EventsClient には操作状態がないので 'use client' を付けず、Server 側で描画する（名前は設計書に合わせた）。page.tsx は getAllIpos() と UTC の todayIso をホームと同じ方式で渡し、dynamic='force-dynamic' を指定、末尾に Disclaimer を置いた。他ページが metadata を個別に設定していないため、metadata は付けていない。
- UI: h1 は『イベントカレンダー』。『新着』は0件なら非表示。『今後90日の予定』は YYYY/MM/DD の小見出しでグルーピングし、0件なら EmptyState『今後90日以内の予定はありません』を出す。各行は Link（min-h-11）で /ipo/[code] へ遷移し、種別 Chip・コード・銘柄名・1行 detail（truncate / min-w-0）を表示する。既存レイアウトの max-w-lg に収まる構成。375px/1280px のブラウザでの実測は build/dev の実行が禁止のため未実施で、integration で確認が必要。
- 導線（ホーム・/ipos・/bb から /events へのリンク）は設計書 §5.4 どおり home/ipos/bb の各タスク担当なので、本タスクでは触っていない。

### risks
- priceReleaseWatch は currentPrice（updater 管理）に依存し、現状データでは該当する銘柄が少ない可能性がある
- bbPeriod / purchasePeriod は base の CSV 由来銘柄では空のため、enriched データ（data-p2）が入るまで BB 系イベントは少なめになる

### unfinished
- /events の 375px・1280px での横はみ出し実測（build/dev 実行が禁止のため integration-p2 で確認）

## data-p2

### publicInterfaces
- scripts/enrich/parse96ut.ts: extractCodeFromTitle, extractRawFields, normalizeLabel, parsePriceRangeText, parseBbPeriodText, parseUnderwriterAllocations, parseMajorShareholders, normalizeToMillionYen, detectStructureChange, parse96utArticle(html, articleUrl, fetchedAtIso): IpoEnriched | null, parse96utArticleWithDiagnostics（診断付き）, LABEL_CANDIDATES
- scripts/enrich/sitemap.ts: fetchSitemapIndex(fetchText?), extractIpoArticleUrls(xml), extractPostSitemapUrls, collectAllIpoArticleUrls(options?), collectFromCategory, politeFetchText, type FetchText = (url) => Promise<{text, url}>
- scripts/enrich/main.ts: runEnrich(options), fetchArticles(urls, options), selectTargets, isListedCode, upsertEnriched, countInsufficient, minListingYear（直接実行時のみ main が走る）
- scripts/enrich/config.ts: BASE_URL, USER_AGENT, HTTP_TIMEOUT_MS=20000, REQUEST_INTERVAL_MS=1000, FILES, SITEMAP_INDEX_URL, CATEGORY_URL
- src/lib/quote.ts: QuotePoint { date, open?, high?, low?, close, volume }, QuoteResponse, fetchQuote(code, signal?, days?), DEFAULT_QUOTE_DAYS=120

### integrationRequests

#### src/lib/merge.ts

applyEnriched の吸収金額の埋め処理で、公開価格ベースが無いとき（上場予定・公開価格が未決定）は想定価格ベースへフォールバックする。これを入れないと、JPX で発見した上場予定銘柄（例: 648A ルクレ）が insufficient（offeringPrice null かつ absorptionAmount 0）のまま残る。差分: `if (isFieldEmpty("count", ipo.absorptionAmount) && isPositive(e.absorptionAmount)) { merged.absorptionAmount = e.absorptionAmount; }` を次に置き換える: `if (isFieldEmpty("count", ipo.absorptionAmount)) { if (isPositive(e.absorptionAmount)) { merged.absorptionAmount = e.absorptionAmount; } else if (isPositive(e.absorptionAmountAssumed)) { merged.absorptionAmount = e.absorptionAmountAssumed; } }`。反映後の試算では insufficient が 12→11 件になる（648A が partial へ上がる）

### notes
- 実行結果（npx tsx scripts/enrich/main.ts、約3.5分）: サイトマップから集めたURLは 2,524 件。そのうち base/auto の最古上場年（2024年）以降の記事 191 件を取得し、成功 191・失敗 0・構造変更の検知 0。ipos.enriched.json は 191 レコードで、sources が空のレコードは 0 件（1レコードあたり出典は約 27〜33 フィールド）
- 突き合わせ: base の 157 件は全件が enriched と一致。JPX で発見した銘柄（auto の discovered:true）40 件のうち 29 件が埋まり、充足度は full 17・partial 11・insufficient 12。見つからなかった 11 件は 590A/575A/543A-547A/640A-642A（社名に * 付きのホールディングス化＝株式移転の「上場」で、96ut に IPO 記事が無い）と 646A クラサスケミカル
- マージ後の充足度（mergeIpos の第3引数あり）: 取得前 full 5 / partial 152 / insufficient 24 → 取得後 full 109 / partial 60 / insufficient 12（12 件改善）。残る 12 件は、記事が無い 11 件と、公開価格が未決定の 648A 1 件。648A は integrationRequests の merge.ts 修正で partial になる（試算で確認済み）
- enriched には base/auto に無いコードが 21 件ある（2024年1月の上場分や TOKYO PRO Market など。例: 231A, 9334, 5241）。表示には影響せず、統計の母数拡大用に残している
- 目視確認① 上場済 618A（記事 2026025）: BB期間 2026-08-27〜09-02、仮条件 1,560〜1,600円、公開価格 1,600円、OR 48.7%、吸収金額は想定 75.1億・公開 77億・初値 71.2億、主幹事 SBI証券と幹事 9 社（割当 92.02%）、売上 5,576.9百万円（+79.8%）で経常赤字のため isProfitable=false、ロックアップ 90日で 1.5倍の解除条項あり、VC 26.68%。いずれもページの表と整合している
- 目視確認② 上場予定 648A ルクレ（記事 2026035。取得できた上場予定銘柄はこの1件のみ）: BB期間 2026-09-29〜10-02、想定価格 1,360円、仮条件は未発表のため priceRange なし、公開価格は未決定のため null（出典なし）、想定ベース吸収金額 52.2億、時価総額 129億、公募 50万株・売出 284万株、OR 40.4%、幹事は野村證券と SBI証券（割当は未公表のため null）、ロックアップ 180日でカバー率 100%。ページの表と整合している
- 設計書との差分①: 業績テーブルの最終行で純資産・総資産がともに 0 の行は「業績予想」とみなし、period に「（予想）」を付ける。financials・EPS/BPS/配当は予想行を除いた最新の実績期から取る（予想値を実績の成長率として扱わないため）
- 設計書との差分②: financials.operatingProfit には経常利益を入れている（96ut の表に営業利益が無いため）。isProfitable は経常利益（無ければ当期利益）が 0 より大きいかで判定
- 設計書との差分③（千円/百万円の判定）: normalizeToMillionYen は設計どおり 10万を境に判定する。ただ表全体の単位は、総資産と時価総額が取れるときは「千円とみなした総資産 ÷ 時価総額 ≥ 0.3%」なら千円、それ未満なら百万円で決めている。大型 IPO の百万円表記を千円と誤判定しないためで、実データでは売上の最大 370,420百万円（大型銘柄）まで妥当に正規化できた
- vcRatio は「VC推定保有」欄の売出後の株数 ÷ 発行済株数 ×100 で算出している（96ut のその欄の % は VC 株のうちロックアップ対象の比率で、保有比率ではないため）
- lockup.hasPriceRelease は、大株主表のロックアップ欄にある「180日 or 1.5倍」、または本文（article 要素）中の「1.5倍で解除」等で true とする。「価格解除なし」や「目標株価1.5倍付近」は拾わないことをテストで確認済み。実データでは 189 件中 59 件が true
- 共同主幹事は base の表記に合わせ、leadUnderwriter を「A・B」形式で保存している（例: 352A「SBI証券・大和証券」）。underwriters は 1 社ずつの配列。主要 8 社の名前は src/data/brokers.ts と完全一致するが、それ以外は 96ut の表記のまま（例: 岡三証券（岡三オンライン）、ＦＦＧ証券）
- sitemap.ts ではサイトマップで取れた場合もカテゴリ一覧の1ページ目（1リクエスト）だけ追加で読む。サイトマップの lastmod が 09-17 で更新が遅れていても、最新の上場予定銘柄を取りこぼさないため。サイトマップが全滅したときは page/N/ を最大10ページ辿る
- 取得時にリダイレクトされた記事はスキップする。96ut は存在しない記事番号を別の記事へ 301 でリダイレクトすることを実測で確認した（2025070 → 2026001）
- main.ts の再取得判定: articleUrl が登録済みで、かつ上場済み（auto/base の status が listed、上場日が今日以前、または base/auto に無く初値ベースの吸収金額がある）ならスキップする。次回からはほぼ上場予定銘柄と新しい記事だけを取得する。取得成功が 0 件のときはファイルを書き換えない
- quote.ts: QuotePoint に open?/high?/low?（number|null、旧レスポンス互換）を追加。fetchQuote(code, signal?, days?) の days は正の数のときだけ ?days=N を付ける。既存の呼び出し元 PriceCard は変更不要
- package.json の enrich:data スクリプトは foundation-p2 が追加済みだったので触っていない。parse96ut.test.ts は先頭の `// @vitest-environment node` で node 環境で実行する

### risks
- parse96ut.ts は cheerio の間接依存 domhandler から `import type { Element }` している。型のみで実行時の影響はないが、cheerio の大きな更新時には確認が必要
- 千円/百万円の判定はヒューリスティック。時価総額に比べて総資産が極端に小さい千円表記の銘柄（千円とみなした総資産 ÷ 時価総額 < 0.3%）は百万円と誤判定しうる。実データ 191 件では異常値は見当たらなかった
- hasPriceRelease の本文走査は article 要素全体が対象。コメント欄などに他の記述があると誤って true になる余地がある
- 96ut のコメント・評価文言は取り込んでいない（enriched.json 内の「初値予想／直前予想／BB参加姿勢」の出現は 0 件）。ただ仮条件欄の「やや強気」など補足文は括弧より前だけを数値として読む前提なので、書式が変わると読み取り精度が落ちる

### unfinished
- merge.ts で吸収金額を想定ベースへフォールバックさせる修正は担当外のため integrationRequests に記載（未反映の間は 648A が insufficient のまま）

## push-p2

### publicInterfaces
- src/types/push.ts: PushSubscriptionJson, PushEventKind, PushSubscriberRecord, PushNotificationPayload（§6.3 どおり）
- src/lib/push/notify.ts: PUSH_EVENT_KINDS, PUSH_EVENT_LABELS, LOCKUP_NOTICE_DAYS, MAX_NOTIFICATIONS_PER_SUBSCRIBER, buildPayload(kind, ipo, options?: {date?, daysUntil?}), selectNotifiableEvents(events: CalendarEvent[], todayIso, options?: {previousWatchCodes?}): PushNotificationPayload[], priceReleaseWatchCodes(events, todayIso), payloadsForSubscriber(payloads, record, max?)
- src/lib/push/subscription.ts: PushKvStore, SUBSCRIBER_PREFIX, MAX_WATCHED_CODES, hashEndpoint, subscriberKey, parseSubscribeBody(body, nowIso), parseUnsubscribeBody, parseStoredRecord, saveSubscriber, deleteSubscriber, listSubscribers, createMemoryKvStore
- src/lib/push/vapid.ts: VapidKeys, importVapidPrivateKey, createVapidJwt(audience, subject, key, nowSeconds), vapidAuthorization(endpoint, vapid, nowSeconds), generateVapidKeys()
- src/lib/push/encrypt.ts: encryptAes128gcm(plaintext, keys, options?), decryptAes128gcm, importEcdhKeyPair, RECORD_SIZE, MAX_PLAINTEXT_BYTES
- src/lib/push/send.ts: buildPushRequest, sendPushRequest(request, fetchImpl?) → {status, ok, expired}, pushTopic
- src/lib/push/kv.ts: getPushKv(), getVapidPublicKey()（サーバー専用）
- POST /api/push/subscribe {subscription, enabledKinds?, watchedCodes?} → 200 {ok, enabledKinds, watchedCount} / 400 / 503 {error:"kv unavailable"}
- POST /api/push/unsubscribe {endpoint} → 200 {ok} / 400 / 503
- GET /api/push/vapid-public-key → 200 {publicKey} / 503
- worker/run-push-notifications.ts: PushWorkerEnv, runPushNotifications(env, {now?, dryRun?, loadIpos?, fetchImpl?, log?}) → RunPushSummary, dryRunPushNotifications, jstTodayIso, WATCH_STATE_KEY。CLI: npx tsx worker/run-push-notifications.ts --dry-run
- worker/push-scheduled.ts: default { fetch, scheduled }（wrangler.jsonc の main 用）
- src/hooks/usePushSubscription.ts: usePushSubscription(watchedCodes, watchReady?) → {support, permission, subscribed, busy, error, subscribe, unsubscribe}, isStandalone()
- src/components/settings/PushOptIn.tsx: <PushOptIn />（props なし）

### integrationRequests

#### src/components/SettingsClient.tsx

プッシュ通知セクションを追加（props 不要。ウォッチリストはコンポーネント内の useWatchlist で読む）。
+ import { PushOptIn } from "@/components/settings/PushOptIn";
...
       <ThemeSection />
+
+      <PushOptIn />

       <DataSection market={market} />
（「アプリとして使う」より上に置くこと。iOS の案内文が『下の「アプリとして使う」の手順』を指しているため。）

#### wrangler.jsonc

設計書 §6.5 の設定。既存キーは残し、main を置き換えて kv_namespaces と triggers を追加する:
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "apollo-ipo",
  "main": "./worker/push-scheduled.ts",
  "compatibility_date": "2026-09-25",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "apollo-ipo" }],
  "kv_namespaces": [
    { "binding": "PUSH_SUBSCRIPTIONS", "id": "<`wrangler kv namespace create PUSH_SUBSCRIPTIONS` で得た ID。本人確認後に取得>" }
  ],
  "triggers": { "crons": ["0 23 * * *"] }
  // VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT は wrangler secret put で投入（ファイルに平文で書かない）
  // 任意: 公開鍵は秘密情報ではないので "vars": { "NEXT_PUBLIC_VAPID_PUBLIC_KEY": "<公開鍵>" } でもよい（/api/push/vapid-public-key は VAPID_PUBLIC_KEY → NEXT_PUBLIC_VAPID_PUBLIC_KEY の順に参照）
  // 既存の r2_buckets コメントはそのまま残す
}
本人確認後に実行するコマンド（本番反映に当たるため、このセッションでは未実行）:
  npx wrangler kv namespace create PUSH_SUBSCRIPTIONS   # 表示された id を上の id に入れる
  npx wrangler secret put VAPID_PRIVATE_KEY   # .env の値を貼る
  npx wrangler secret put VAPID_PUBLIC_KEY
  npx wrangler secret put VAPID_SUBJECT
  npm run deploy
ローカル確認: `npm run preview` の前に .env の値を .dev.vars（gitignore 済み）へコピーする（wrangler は .dev.vars が無いときだけ .env を読む）。Cron の手動実行: curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+23+*+*+*"（wrangler dev は /cdn-cgi/local/scheduled も受け付ける）。KV への書き込み確認: curl -X POST localhost:8787/api/push/subscribe -H 'content-type: application/json' -d '{"subscription":{"endpoint":"https://example.com/x","keys":{"p256dh":"AAAA","auth":"AAAA"}},"watchedCodes":["1234"]}' → {ok:true}

#### .gitignore

`.env*` が .env.example まで無視しているので、例外を1行追加する:
 # env files (can opt-in for committing if needed)
 .env*
+!.env.example

#### package.json

変更不要（依存追加なし）。@pushforge/builder は検証の結果採用しなかった（notes 参照）。

#### next.config.ts

任意（コメントの修正のみ）: 末尾コメントの「コード側から bindings を参照する箇所が無い」は古くなった。/api/push/* が getCloudflareContext で PUSH_SUBSCRIPTIONS を参照するようになったが、next dev では initOpenNextCloudflareForDev を呼ばない方針のままでよい（503 {error:"kv unavailable"} を返す）。

### notes
- ライブラリの検証結果: @pushforge/builder@2.0.5 は依存ゼロ・Web Crypto のみで、Node 22 で VAPID JWT 署名と暗号化は動いた（scratch/tmp/pushforge-check/verify.ts）。ただし出力が旧ドラフトの `Content-Encoding: aesgcm`（Encryption / Crypto-Key ヘッダ付き）で、設計書が求める RFC 8291 aes128gcm ではなかった。iOS の Web Push を含めて標準に確実に沿うため採用せず、依存追加0で vapid.ts（RFC 8292 ES256）と encrypt.ts（RFC 8291 aes128gcm）を crypto.subtle で自前実装した。encrypt は RFC 8291 付録Aのテストベクタ（rfc-editor.org から取得）とバイト単位で一致する
- VAPID 鍵の形式は web-push 互換: 公開鍵 = raw 65バイトの base64url、秘密鍵 = d 32バイトの base64url。.env は Node の webcrypto で生成して直接書き込んだ（値は表示していない）。生成コマンドは .env.example のコメントに残した（node の1行コマンド）
- KV キーは `sub:` + SHA-256(endpoint) の16進。`sub:` を付けたのは、1.5倍ライン監視の前回状態（キー `state:price-release-watch`）と分けるため
- 1.5倍ラインの通知: events-p2 の priceReleaseWatchEvent は監視中のあいだ毎日 date=today を返す。毎日同じ通知が届かないよう、Cron が前回の監視中コードを KV に保存し、selectNotifiableEvents(events, todayIso, { previousWatchCodes }) で新しく監視に入った銘柄だけを通知する（設計書 §6.2 の「新規到達」）。オプションを省略したときは監視中の全銘柄が対象（関数の形は設計どおり）
- watchedCodes の扱い: 設計書には「空配列は『ウォッチ全銘柄』」とあるが、サーバーはウォッチリスト（localStorage）を持たない。そこでクライアントがウォッチリストの全コードを送り、空なら通知しない形にした（v1 は『ウォッチリストの銘柄のみ』で固定）。購読中にウォッチリストが変わると、フックがサーバーへ送り直す（800ms デバウンス）
- iOS の standalone 判定: トグルを無効にするのは iOS かつホーム画面から開いていない場合だけ。PC やアンドロイドのブラウザではホーム画面に追加しなくても Web Push が使えるため、設計書の受け入れ基準「iOS standalone 判定でトグルの活性/非活性が切り替わる」を満たしつつ、ほかの環境は壊さない方を選んだ
- 1購読者あたり1回の Cron で送る通知は最大5件（MAX_NOTIFICATIONS_PER_SUBSCRIBER）。優先順は 本日購入期限 > 明日抽選 > 明日BB開始 > ロックアップ解除3日以内 > 1.5倍ライン監視。TTL は12時間、Topic は `<kind>-<code>`
- /api/push/vapid-public-key を追加した。公開鍵を NEXT_PUBLIC_ としてビルド時に埋め込まなくても、実行時に取得できる。localStorage のキーは増やしていない（購読状態は KV とブラウザの pushManager で持つ）
- worker/types.d.ts は作っていない。@cloudflare/workers-types の型を使わず、ScheduledController / ExecutionContext / KVNamespace は使う部分だけを各ファイルのローカル interface（PushKvStore など）で定義した。wrangler types が生成する cloudflare-env.d.ts とも衝突しない
- worker/push-scheduled.ts は公式 how-to どおり `.open-next/worker.js` の default.fetch を再利用し、DOQueueHandler / DOShardedTagCache / BucketCachePurge を再エクスポートする（生成済み worker.js が3つとも export していることを確認済み）。import に @ts-ignore を使ったのは、ビルド前後でファイルの有無が変わり @ts-expect-error では両方の状態を満たせないため（eslint-disable を併記）
- worker のテストは vitest の include（src/**/*.test）に入るよう src/lib/push/run.test.ts に置き、../../../worker/run-push-notifications を import している。dryRunPushNotifications(env, opts) と runPushNotifications(env, { dryRun: true }) は送信も KV への書き込みもしない
- 禁止語チェック: src/lib/push などの担当ファイルに禁止語は0件。テスト用の禁止語リスト（fixtures.test-helper.ts）は \u エスケープで持ち、src への grep に引っかからないようにした
- scratch/tmp/pushforge-check/verify.ts（検証用スクリプト）はルートの tsconfig の include に入るため、先頭に // @ts-nocheck を付けた。scratch/tmp は gitignore 済み。ほかに scratch/tmp に rfc8291.txt と wrangler.push-check.jsonc を置いた（削除はしていない）
- 作業中に vitest.config.ts・package.json などがほかのタスクによって変更されていたが、どれも触っていない

### risks
- 本番での実配信（Apple / FCM / Mozilla）はまだ確認していない。暗号化は RFC ベクタで、署名は検証で担保しているが、最終確認は本人がデプロイした後に実機で行う必要がある
- custom worker のバンドルは、既存（古い可能性あり）の .open-next を使った wrangler deploy --dry-run でしか確認していない。integration の npm run build / preview で、main 変更後のビルドと KV の解決を改めて確認すること
- iOS の Web Push は、ホーム画面に追加した PWA で、manifest の display が standalone のときだけ動く。manifest の設定はこのタスクの範囲外
- Cron の送信は、購読数×通知数ぶんを逐次 fetch する。個人利用の規模なら問題ないが、購読が数百を超える場合は CPU 時間の上限に注意
- wrangler.jsonc の main を worker/push-scheduled.ts に切り替えると、.open-next/worker.js が無い状態では wrangler dev / deploy が失敗する（opennextjs-cloudflare build が先に走る npm run preview / deploy なら問題ない）

### unfinished
- SettingsClient への PushOptIn の差し込み（integrationRequests に記載）
- wrangler.jsonc の反映、KV namespace の作成、secret の投入、デプロイ（本人確認後。integrationRequests に記載）
- .gitignore に !.env.example を追加（integrationRequests に記載。これが無いと .env.example がコミットされない）
- npm run preview での /api/push/subscribe → ローカル KV 書き込みの確認と、Cron の手動実行（integration タスクが行う）

## scoring-p2

### publicInterfaces
- src/lib/scoring/bb.ts: type BbScoreItemKey, BB_SCORE_KEYS, BB_SCORE_ITEM_LABELS, type BbScoreWeights, DEFAULT_BB_WEIGHTS, UNDERWRITER_MIN_SAMPLE, interface BbScoreItemOutput, interface BbScoreResult
- scoreOfferingRatioBb(ipo: Ipo): ItemOutput
- scoreUnderwriterTrack(stat: UnderwriterBreakEvenStat | null): ItemOutput
- scorePriceRangePosition(ipo: Ipo): ItemOutput
- scoreBbParticipation(ipo: Ipo, settings: ScoreSettings, underwriterStat: UnderwriterBreakEvenStat | null, weights?: BbScoreWeights): BbScoreResult

### integrationRequests

#### scratch/backtest/report-phase2.md

ハーネスがこのサブエージェントからの .md 書き込みを拒否した（「Subagents should return findings as text」）ため、ファイルを作れていない。回避はしていない。orchestrator が次の内容をそのまま書き出してください:

# BB参加スコア 重み再校正レポート（Phase 2 / 設計書 §3.4）

検証日: 2026-09-25 / スクリプト: `scratch/backtest/recalibrate_bb.py`（`cd scratch/backtest && ./venv/bin/python recalibrate_bb.py` で再現できる）
パネル出力: `scratch/backtest/data/out/bb_score_panel.csv`

## 結論
- 暫定重みでも選別力がはっきり出た。上位30%は中央値 +38.9%・初値超え率 86%。下位30%は中央値 +2.1%・初値超え率 54%・公募割れ率 44%。スコアと初値騰落率の Spearman は +0.457。2024/2025/2026 の3年とも同じ向き（年別の Spearman は +0.41〜+0.49）
- 6項目のうち、主幹事の公募割れ実績だけ相関がほぼゼロ（Spearman +0.017）。§3.4 の規律どおり1段階だけ下げて（3→2）再検証した。Spearman は +0.457→+0.466 で、年別も3年すべて改善。中央値差は +36.8→+36.6pt で横ばい。改善幅は小さいが、悪化した指標はない→採用
- 採用した重み（bb.ts の DEFAULT_BB_WEIGHTS に反映済み）: absorption 4 / offeringRatioBb 4 / underwriterTrack 2（暫定は3） / priceRangePosition 3 / vcLockup 2 / sentiment 2
- 既存の2軸スコアと需給重視プリセットは変更しない（§3.3）

## データ
| 項目 | 内容 |
|---|---|
| 母数 | 168銘柄（ipo_list 169件のうち公開価格・初値がそろうもの。598A は初値欠損で除外） |
| 年別 | 2024: 86 / 2025: 65 / 2026: 17 |
| JOIN | ipo_list.csv + fundamentals.csv + public/data/ipos.enriched.json（168件すべて一致）を code で結合 |
| 目的変数 | 初値騰落率 = (初値−公開価格)÷公開価格×100 |
| 全体 | 平均 +32.9% / 中央値 +24.3% / 初値超え率 75% / 公募割れ率 22% |

各項目の閾値は bb.ts と同じ。吸収金額: <10 +2 / <30 +1 / <100 0 / <500 −1 / それ以上 −2。OR: <10 +2 / <20 +1 / <30 0 / <50 −1 / それ以上 −2。主幹事実績は leave-one-out の公募割れ率で、<5 +2 / <10 +1 / <20 0 / <30 −1 / それ以上 −2、母数5未満は0。仮条件は checkPriceRangeRevision と同じ境界で、上振れ +2 / 下振れ −2 / レンジ内・未取得 0。VC×ロックアップは既存マトリクス（未取得0）。地合いは上場前営業日の日経平均 25日MA 乖離で、+2%超 strong / −2%未満 weak。0〜100換算は buildAxis と同じ（Math.round と同じ丸め）。

## 1. 項目別相関
| 項目 | 取得率 | +2 | +1 | 0 | −1 | −2 | Pearson | Spearman |
|---|---|---|---|---|---|---|---|---|
| 吸収金額 | 100% | 39 | 59 | 44 | 19 | 7 | +0.357 | +0.365 |
| OR | 100% | 3 | 30 | 51 | 67 | 17 | +0.211 | +0.218 |
| 主幹事実績 | 90% | 0 | 4 | 99 | 52 | 13 | −0.052 | +0.017 |
| 仮条件の位置 | 100% | 25 | 0 | 125 | 0 | 18 | +0.188 | +0.236 |
| VC×ロックアップ | 100% | 79 | 20 | 47 | 22 | 0 | +0.039 | +0.111 |
| 地合い | 100% | 59 | 0 | 96 | 0 | 13 | +0.259 | +0.243 |

points別の中央値（括弧内は件数）: 吸収金額 +35%(39)/+36%(59)/+5%(44)/+7%(19)/+9%(7)。OR +33%(3)/+33%(30)/+29%(51)/+25%(67)/+2%(17)。主幹事 —/−8%(4)/+27%(99)/+26%(52)/+2%(13)。仮条件 +36%(25)/—/+25%(125)/—/+2%(18)。VC×ロック +30%(79)/+15%(20)/+19%(47)/+20%(22)/—。地合い +31%(59)/—/+19%(96)/—/+17%(13)。項目間の相関で最大なのは吸収金額×OR の +0.33 で、それ以外は |0.22| 以下。

## 2. 暫定重みでの上位30% vs 下位30%
| 群 | n | 平均 | 中央値 | 初値超え率 | 公募割れ率 |
|---|---|---|---|---|---|
| 上位30% | 50 | +53.7% | +38.9% | 86% | 10% |
| 下位30% | 50 | +11.7% | +2.1% | 54% | 44% |
| 差 | | +42.0pt | +36.8pt | +32pt | |
ブートストラップ（1000回・seed固定）: 中央値差の95%区間は +24.4〜+47.4pt（0以下になった回は0%）、Spearman の95%区間は +0.315〜+0.580

## 3. 年別
| 年 | n | Spearman | 上位平均 | 下位平均 | 上位中央値 | 下位中央値 | 上位初値超え率 | 下位初値超え率 |
|---|---|---|---|---|---|---|---|---|
| 2024 | 86 | +0.414 | +52.6% | +11.2% | +41.0% | +2.8% | 88% | 50% |
| 2025 | 65 | +0.489 | +70.3% | +13.8% | +42.4% | +2.6% | 90% | 70% |
| 2026 | 17 | +0.467 | +42.1% | +0.2% | +17.1% | −2.4% | 80% | 20% |
2026年は17件（上位/下位は各5件）しかなく、目安としては弱い。

## 4. 近傍グリッド（各重み±1）
基準: Spearman +0.457 / 平均差 +42.0 / 中央値差 +36.8 / 初値超え率差 +32。
吸収金額 −1: .434/39.0/32.6/32、+1: .468/48.6/38.4/34。OR −1: .465/44.4/38.6/34、+1: .443/39.8/34.6/30。主幹事 −1: .466/45.3/36.6/30、+1: .443/42.5/36.6/30。仮条件 −1: .449/43.4/38.2/30、+1: .465/44.1/35.9/32。VC −1: .467/47.0/36.3/34、+1: .447/43.2/39.8/30。地合い −1: .447/45.6/36.8/34、+1: .455/46.4/38.7/34。
どの±1でも Spearman は +0.43〜+0.47、中央値差は +32〜+40pt に収まる。重みの細かい値には左右されない。同じサンプルで最良点を選ぶと過学習になるため、規律の1回調整以外は動かしていない。

## 5. §3.4 の判断
1. 上位群は下位群を明確に上回った→暫定重みはおおむね妥当
2. 弱い項目（Spearman<+0.10）は主幹事実績（+0.017）のみ
3. この項目を 3→2 に1回だけ調整して再検証: Spearman +0.466 / 平均差 +45.3 / 中央値差 +36.6 / 初値超え率差 +30。年別 Spearman は 2024 +0.417 / 2025 +0.509 / 2026 +0.473 で、3年とも改善。ブートストラップで調整後が暫定を上回った割合は 88%（平均 +0.009）
4. 改善は小さいが、悪化した指標がないため確定値として採用
5. 主幹事実績は0にしない。データが増えたら再検証する

## 6. 感度分析（暫定重み）
主幹事実績を上場日より前の銘柄だけで計算: +0.448 / +44.6 / +35.7 / +32。地合いの閾値を±0.5%に変更: +0.453 / +43.3 / +37.3 / +30。上位/下位を20%で切る: 差 +49.7 / +37.3 / +35。50%で切る: +36.3 / +31.5 / +24。どの前提でも差は残る。

## 7. 限界
- サンプル内の検証: 閾値は report.md で同じ期間から見つけた傾向に基づく。アウトオブサンプルでの検証はなく、実運用ではこの結果より差が小さくなる可能性が高い
- 母数: 全体168・年別 86/65/17。points の端（OR+2 が3件、主幹事+1 が4件）は件数が少なく、目安にならない
- 生存者バイアス: 上場中止・延期の案件は含まない。上場後に廃止された銘柄（オルツ 260A 等）は含む。report.md（日足）よりは小さいがゼロではない
- 地合いの近似: アプリは market.json の合成判定（日経・グロース250・直近初値）を使う。本検証は日経の乖離だけで近似しており、アプリの判定とは一致しない
- 仮条件のデータ: 本検証は enriched の想定価格・仮条件を使った。アプリでは base 157件の assumedPrice/priceRange が公開価格と同じ値で埋まっており、現行の merge では上書きされないため、この項目は多くの上場済み銘柄で「未取得」（0点）になる
- 主幹事実績のリーク: アプリの underwriterBreakEvenStat は上場済み銘柄自身も集計に含むため、呼び出し側で対象銘柄を除いて渡すのが望ましい
- 本スコアは実績分布の機械的な集計で、将来の初値を示すものではない

## 8. 今後
- 上場済みが50件増えるごとに recalibrate_bb.py を再実行し、同じ規律で見直す
- 主幹事名の表記揺れ（共同主幹事等）を正規化してから再検証する

#### src/lib/merge.ts

（任意・foundation 判断）base の CSV 由来157件は assumedPrice / priceRange.low / priceRange.high がすべて offeringPrice と同じ値のプレースホルダーになっている。isFieldEmpty("price") は偽になるため、enriched にある実際の想定価格と仮条件が反映されない。その結果、BB参加スコアの priceRangePosition（と checklist の仮条件の位置）は、上場済み銘柄では常に中立・未取得になる。案: applyEnriched の価格ブロックの前に次を追加する。

+  // CSV 由来の base は想定価格・仮条件を公開価格で埋めたプレースホルダー。enriched に実値があれば置き換える。
+  const isCsvPricePlaceholder =
+    ipo.offeringPrice !== null &&
+    ipo.assumedPrice === ipo.offeringPrice &&
+    ipo.priceRange.low === ipo.offeringPrice &&
+    ipo.priceRange.high === ipo.offeringPrice;
+  if (isCsvPricePlaceholder && isPositive(e.assumedPrice) && e.priceRange && isPositive(e.priceRange.low) && isPositive(e.priceRange.high)) {
+    merged.assumedPrice = e.assumedPrice;
+    merged.priceRange = { low: e.priceRange.low, high: e.priceRange.high };
+  }

（これは「base の手動値は上書きしない」規則の例外になる。採否は foundation/integration が判断する）

#### src/components/IpoDetailClient.tsx ほか BB参加スコアの呼び出し側（detail/home/bb）

呼び出し例: `scoreBbParticipation(ipo, settings, underwriterBreakEvenStat(allIpos.filter((i) => i.code !== ipo.code), ipo.leadUnderwriter))`。上場済み銘柄自身を主幹事実績から除く（リーク回避）。上場前の銘柄では結果は同じ。import 元は `@/lib/scoring/bb`（scoring/index.ts からは re-export していない。index.ts は読み取り専用のため）。

### notes
- report-phase2.md は未作成。Write ツールが「サブエージェントは .md のレポートファイルを書かない」として拒否したため。Bash 経由での回避はせず、全文を integrationRequests[0] に入れた。orchestrator がそのまま書き出せば完了条件を満たす
- バックテスト結果（168銘柄）: 暫定重みでは上位30%の中央値 +38.9%・初値超え率86%、下位30%は中央値 +2.1%・初値超え率54%。Spearman +0.457。3年とも同じ向き。弱い項目は主幹事実績（+0.017）だけだったので 3→2 に1回だけ下げて再検証し、採用した（Spearman +0.466、年別3年とも改善）。DEFAULT_BB_WEIGHTS = {absorption:4, offeringRatioBb:4, underwriterTrack:2, priceRangePosition:3, vcLockup:2, sentiment:2}
- 設計書 §3.2 の暫定値と実装の差分は underwriterTrack 3→2 のみ（§3.4 の規律による確定）
- 未取得の扱い: offeringRatio<=0、absorptionAmount<=0、lockup.days<=0、仮条件未取得（assumedPrice<=0 または high<=0）は 0点・rawText「未取得」。既存の scoreAbsorption は 0 を渡すと +2 を返すため、bb.ts 側で先に判定して回避した（items.ts は変更していない）
- priceRangePosition は checkPriceRangeRevision と同じ境界（上振れ +2 / 下振れ −2 / レンジ内 0 / 未取得 0）。merge が仮条件未発表時に想定価格を low=high で埋めるケースも「未取得」表示にした（点数はどちらでも0で、checklist と一致）。テストでも checklist の verdict と突き合わせている
- scoreUnderwriterTrack の段階: 公募割れ率 <5 +2 / <10 +1 / <20 0 / <30 −1 / それ以上 −2。母数5未満と null は 0点。UNDERWRITER_MIN_SAMPLE=5 を export している
- BbScoreResult は設計書どおり {score, items} のみ（rawTotal などは持たない）。ScoreBreakdown 用のアダプタは detail タスクの担当
- recalibrate_bb.py の主幹事実績は leave-one-out。上場日前だけを使う版でも感度分析をしており、結論は同じだった。地合いは日経 25MA 乖離 ±2% で近似した（±0.5% でも結論は同じ）
- 禁止語 grep 0（bb.ts / bb.test.ts）

### risks
- バックテストはサンプル内の検証（同じ期間から閾値を導出している）。2026年は17件で母数が小さい
- base の CSV 由来銘柄では priceRangePosition が実質常に未取得（merge の規則が原因。integrationRequests[1]）
- アプリの地合い判定はバックテストの近似（日経乖離のみ）と異なる
- underwriterBreakEvenStat をそのまま渡すと、上場済み銘柄で自身の結果が混ざる（integrationRequests[2]）

### unfinished
- scratch/backtest/report-phase2.md の書き出し（ハーネスが拒否。内容は integrationRequests[0] に全文あり）

## home-p2

### publicInterfaces
- src/lib/home: export interface BbHighlightItem { ipo: Ipo; bbScore: number }
- src/lib/home: export function topBbCandidates<T extends BbHighlightItem>(scored: T[], n = 3, completenessFn: (ipo: Ipo) => CompletenessResult = assessCompleteness): T[]  // status upcoming/bb_open/priced のみ・insufficient除外・bbScore降順・同点は listingDate 昇順（空文字は後ろ）・入力非破壊
- src/components/home/BbCandidates.tsx: export function computeBbCandidates(ipos: Ipo[], settings: ScoreSettings, n = 3): BbHighlightItem[]  // 主幹事ごとに underwriterBreakEvenStat(ipos, lead) を1回だけ集計してキャッシュ → scoreBbParticipation → topBbCandidates
- src/components/home/BbCandidates.tsx: export function BbCandidates({ items: BbHighlightItem[], watched: (code) => boolean, onToggleWatch: (code) => void })  // 0件は EmptyState「現在BB受付中・受付前で条件一致の銘柄はありません」

### integrationRequests

#### src/components/home/HomeClient.tsx

① import 追加（既存 import 群の末尾）:
```ts
import Link from "next/link";
import { BbCandidates, computeBbCandidates } from "./BbCandidates";
```
② BB参加候補の計算（picks の useMemo の直後に追加）:
```ts
  // BB参加スコア上位（upcoming/bb_open/priced・データ十分のみ）。
  const bbCandidates = useMemo(
    () => computeBbCandidates(ipos, settings, 3),
    [ipos, settings],
  );
```
③ JSX: 設計書§7の順（サマリー → BB参加候補 → 今後14日の予定 → スコア上位 → 需給ハイライト）。「サマリー」Section の直後、「今後14日の予定」Section の前に挿入:
```tsx
      <Section
        title="BB参加候補"
        note="BB参加スコア（吸収金額・OR・主幹事実績等の機械的集計）の上位。参考情報です"
      >
        <BbCandidates
          items={bbCandidates}
          watched={isWatched}
          onToggleWatch={toggle}
        />
      </Section>
```
④ 「今後14日の予定」Section の中身を次に置き換え（見出し下に /events リンク）:
```tsx
      <Section title="今後14日の予定" note="BB開始・抽選・購入期間・上場の日付順">
        <Link
          href="/events"
          className="mb-2 flex min-h-11 items-center text-xs font-medium text-accent-2 active:opacity-80"
        >
          上場後の予定は /events でまとめて確認できます →
        </Link>
        <EventTimeline events={events} />
      </Section>
```
（表示文言からパスを除くなら「上場後の予定（ロックアップ解除・決算など）はイベント一覧でまとめて確認できます →」も可。設計書どおりにするなら上記のまま）
⑤ TopPicks の note 変更:
```diff
-        note="総合スコアの機械的な上位（参考情報。データ十分な銘柄のみ）"
+        note="総合スコア（需給・ファンダ）の機械的な上位"
```
需給ハイライト（SupplyDemandHighlights）は変更なし・BB参加候補の後ろ（既存位置のまま）で§7の「需給ハイライトの前に追加」を満たす。

### notes
- IpoCard は需給/ファンダの ScorePill を必須 props で表示するため変更せず、BbCandidates 内に IpoCard と同じ見た目の軽量カード（Link・Chip・WatchStar・ScorePill label="BB参加"）を既存部品で組んだ。表示項目は BB期間（MM/DD〜MM/DD、未設定は「未取得」）・上場日・吸収金額（0は「未取得」）。数値は tabular-nums、WatchStar は min-h-11。
- BbCandidates.tsx に "use client" は付けていない（TopPicks と同様、クライアントの HomeClient から使う前提。WatchStar 側が "use client"）。
- scoreBbParticipation は @/lib/scoring の index から再exportされていないため @/lib/scoring/bb から直接 import。ScoreSettings 型は @/lib/scoring から。
- computeBbCandidates は todayIso を受け取らない（選定はステータスで行い日付を使わないため不要。Date.now も不使用）。listed は計算前に除外して無駄な集計を省く（topBbCandidates 側でも除外）。
- lib/home/index.ts は assessCompleteness を実行時 import に追加（既定の completenessFn 用）。既存関数は無変更。

### risks
- BB参加候補の件数は status が upcoming/bb_open/priced かつ completeness が insufficient でない銘柄に依存する。enriched（data-p2）未反映の状態では該当0件で EmptyState 表示になる可能性がある（想定動作）。
- /events ページ（events-p2）が未作成のまま統合すると ④のリンクが404になる。

### unfinished


## bb-p2

### publicInterfaces
- src/lib/bb/priority.ts: interface BrokerPriorityEntry; rankBrokersForIpo(ipo: Ipo, brokers: Broker[], allocations: UnderwriterAllocation[] | undefined): BrokerPriorityEntry[]; LOTTERY_TYPE_LABELS; normalizeBrokerName(name): string; isSameBrokerName(a, b): boolean; matchBrokerName(name, brokers): Broker | undefined; isLeadBroker(broker, leadUnderwriter): boolean
- src/lib/bb/fundLock.ts: interface FundLockPeriod; interface FundLockGroup {broker, overlapping, totalAmount, peakAmount}; FUND_LOCK_STATUSES; buildFundLockPeriods(ipos, brokers, bbState): FundLockPeriod[]; periodsOverlap(a, b): boolean; groupOverlappingLocks(periods): FundLockGroup[]
- src/components/bb/BrokerPriorityList.tsx: BrokerPriorityList({priorities, includeBrokers?, renderAction?, syndicateKnown?})
- src/components/bb/FundLockCalendar.tsx: FundLockCalendar({groups})
- src/components/bb/BbIpoCard.tsx: BbIpoCard({ipo, brokers, priorities, bbScore, getEntry, setStatus})
- src/components/BbManagerClient.tsx: BbManagerClient({ipos, brokers, enriched?, autoSentiment?})

### integrationRequests

#### /Users/kazukiyoshida/ipo-analyzer/src/app/bb/page.tsx

Pass the auto-detected sentiment into the sentiment item of the BB participation score (my task scope only allowed adding getAllEnriched, so I have not done this). Without it, auto mode treats sentiment as neutral. Diff: change `import { getAllEnriched, getAllIpos, getDefaultBrokers } from "@/lib/repository";` to `import { getAllEnriched, getAllIpos, getDefaultBrokers, getMarketData } from "@/lib/repository";`, change `const [ipos, enriched] = await Promise.all([getAllIpos(), getAllEnriched()]);` to `const [ipos, enriched, market] = await Promise.all([getAllIpos(), getAllEnriched(), getMarketData()]);`, and change `<BbManagerClient ipos={ipos} brokers={brokers} enriched={allocations} />` to `<BbManagerClient ipos={ipos} brokers={brokers} enriched={allocations} autoSentiment={market.sentiment} />`. BbManagerClient already accepts the optional prop autoSentiment?: Sentiment.

### notes
- rankBrokersForIpo follows the §4.2 formula literally: allocation ratio (%, as a 0-100 value) × lottery coefficient × 10, plus 5 if no deposit is required, clamped to 0-100 and rounded to 1 decimal. In 96ut data the lead underwriter's ratio is 80-95%, so the lead usually hits the 100 cap and the lottery coefficient no longer separates leads. With the tie order in place (in syndicate → lead → ratio descending → name), the lead still comes first. Among underwriting members (0.5-10%) the coefficient ordering works as designed.
- Fallback: when allocations is undefined or an empty array, or when a broker has an allocation row but ratioPercent is null, that broker scores lead 60 / member 30 × coefficient + bonus, with allocationRatioPercent null and reason set to 「幹事配分 未取得・{抽選方式}」. Syndicate membership is the union of allocations, ipo.underwriters and ipo.leadUnderwriter.
- Name matching: priority.ts exports normalizeBrokerName (NFKC → strip everything from the first bracket on → remove whitespace → 證 to 証 → remove 株式会社 → remove a trailing 証券 → uppercase), isSameBrokerName(a, b), matchBrokerName(name, brokers): Broker | undefined, and isLeadBroker(broker, leadUnderwriter). isLeadBroker also handles co-lead strings such as 「SMBC日興証券・三菱UFJモルガン・スタンレー証券」 by splitting on ・、,/. The tests confirm that 岡三証券（岡三オンライン）, 岡三にいがた and 三菱UFJモルガン・スタンレー証券 do not match DEFAULT_BROKERS.
- fundLock: FundLockGroup gets one extra field, peakAmount (the largest amount locked at the same time; for a chain of overlaps this is more accurate than the total). The design's fields are unchanged. The UI shows both the peak and totalAmount. groupOverlappingLocks returns connected components within a broker, so if A-B and B-C overlap, A, B and C form one group. Single periods are also returned as groups of 1, and the UI only shows groups with 2 or more.
- Lock period follows the design: start = purchase period start, or BB start if missing; end = purchase period end, or allotment date, or BB end. Only brokers with requiresDeposit and statuses planned/applied (FUND_LOCK_STATUSES) are included. Periods with a missing date or end < start are excluded. The existing BbSummary 資金拘束目安 (applied/won) is left as is.
- UI: BbIpoCard gets new props priorities: BrokerPriorityEntry[] and bbScore: number | null (breaking change, but its only caller is BbManagerClient). Broker rows are listed in priority order with the out-of-syndicate brokers at the end, so status changes stay available for every broker. The top row gets Chip tone=accent 「優先」 and the 主幹事 chip becomes neutral. When the syndicate is unknown, a line says 「幹事団の情報は未取得です」 and remaining rows are labeled 「幹事団 未取得」. The BB participation badge (ScorePill label 「BB参加」) is hidden (null) for insufficient stocks.
- BrokerPriorityList({priorities, includeBrokers?, renderAction?, syndicateKnown?}) can also be used without actions (for example by detail-p2's UnderwriterPriority).
- BbManagerClient: added a 44px text link to /events 「上場後の予定はイベント一覧で確認できます →」 under the heading, and FundLockCalendar (section hidden when there are 0 overlaps) between BbSummary and the cards. The existing localStorage saving of statuses (useBbState) and the summary are unchanged. BB scores use scoreBbParticipation(ipo, settings, underwriterBreakEvenStat(ipos, ipo.leadUnderwriter)).
- page.tsx: the full enriched file (about 1.8MB) would have been too large to send to the client, so the page only passes {code, underwriterAllocations} for records that have allocations. The client prop type is Pick<IpoEnriched, "code" | "underwriterAllocations">[].

### risks
- Because of the ×10 scaling, allocation ratios of 10% or more all hit the 100 cap, so lottery method and deposit are not reflected among leads or large co-leads. A literal reading of the design formula; revisit if needed.
- BbIpoCard's props changed in a breaking way. It currently has no caller other than BbManagerClient.
- useSettings returns a new settings object on every render, so the BB score useMemo recomputes each render. With about 30 target stocks × 181 stocks the cost is negligible.

### unfinished
- Wiring autoSentiment into bb/page.tsx is out of my scope, so it is listed in integrationRequests. Until then the sentiment item is neutral in auto mode.
- Checking /bb at 375px and 1280px for horizontal overflow needs a dev/preview server, which is forbidden for this task, so it has not been done (for integration).
