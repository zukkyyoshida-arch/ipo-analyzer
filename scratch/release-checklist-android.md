# カブレーダー Android（TWA）リリースチェックリスト

確認日: 2026-10-19 / ブランチ: claude/kabu-radar-release-design-968aae / 対象: v1.1.0（versionCode 2）
凡例: ✅ 検証済み / ⚠️ 要注意・要判断 / 未検証 = 実機など手元で確かめていない

## 1. twa-manifest.json

| 項目 | 結果 | 根拠 |
|---|---|---|
| アプリ名 | ✅ | name / launcherName「カブレーダー」。APK の aapt `application-label:'カブレーダー'` |
| packageId | ✅ | `com.zukky.kaburadar`（aapt `package: name='com.zukky.kaburadar'`、assetlinks と一致） |
| アイコン（any） | ✅ | iconUrl `/icons/icon-512.png` → 本番 200 image/png、512x512（sips）、本番とリポジトリの md5 一致 |
| アイコン（maskable） | ✅ | maskableIconUrl `/icons/icon-maskable-512.png` → 本番 200 image/png、512x512、md5 一致 |
| スプラッシュ背景 | ✅ | backgroundColor #1F1F1F → APK の `color/backgroundColor = 0xff1f1f1f`。色の値は別セッションで変更予定（変更後は再ビルド必要） |
| ショートカット | ✅ | 3 件追加: 銘柄一覧 /ipos・BB管理 /bb・予定 /events（chosenIconUrl は icon-192）。app/build.gradle に反映、APK に `drawable/shortcut_0..2` と文字列あり。各 URL 本番 200 |
| バージョン | ✅ | appVersionName / appVersion 1.1.0、appVersionCode 2。aapt `versionCode='2' versionName='1.1.0'` |
| minSdk / 画面向き | ✅ | minSdkVersion 24（aapt `sdkVersion:'24'`）、orientation portrait |
| fallbackType | ✅ | customtabs（検証失敗時は Custom Tabs で表示） |
| 実機でのショートカット表示 | 未検証 | 実機・エミュレータでの長押し確認はしていない |

## 2. 全画面条件（Digital Asset Links）

| 項目 | 結果 | 根拠 |
|---|---|---|
| 鍵の SHA-256 | ✅ | `keytool -list -v -keystore android-twa/android.keystore` → `15:D4:4A:…:91:B1:97` |
| APK 署名の SHA-256 | ✅ | `apksigner verify --print-certs` → `15d44a0a…2e91b197`（同じ値） |
| twa-manifest fingerprints | ✅ | 同値 |
| 本番 assetlinks.json | ✅ | `curl https://kabu-radar.zukky-yoshida.workers.dev/.well-known/assetlinks.json` → 200 application/json、`public/.well-known/assetlinks.json` と JSON diff なし |
| package_name 一致 | ✅ | assetlinks・twa-manifest・APK すべて `com.zukky.kaburadar` |
| intent-filter autoVerify | ✅ | AndroidManifest に `android:autoVerify=true`・scheme https |
| 実機で URL バーが消えるか | 未検証 | 実機で `adb shell pm get-app-links com.zukky.kaburadar` が verified になるか未確認。手順は README「端末で確認する」 |

## 3. README

| 項目 | 結果 | 根拠 |
|---|---|---|
| 「端末で確認する」小節 | ✅ | install → 起動 → `pm verify-app-links --re-verify` → `pm get-app-links` → 残る場合の確認点（assetlinks 配信・指紋・既定ブラウザ） |
| バージョン・ショートカット更新手順 | ✅ | 「バージョン・ショートカットを変える」小節を追加 |

## 4. 本番 PWA

| 項目 | 結果 | 根拠 |
|---|---|---|
| manifest 基本項目 | ✅ | 本番 /manifest.webmanifest 200 application/manifest+json: name/short_name カブレーダー、id "/"、start_url "/"、scope "/"、display standalone、lang ja、theme/background #1f1f1f |
| icons の purpose | ✅ | any 192/512 + maskable 192/512 を分けて記載（"any maskable" 併記なし） |
| shortcuts（PWA 側） | ⚠️ | `src/app/manifest.ts` に TWA と同じ 3 件を追加済み。本番反映は main マージ後（現在の本番 manifest には shortcuts なし） |
| オフライン | ✅ | 本番 /sw.js がリポジトリと同一。ナビゲーションはネットワーク優先→キャッシュ→`/offline`。`/offline` 本番 200（「オフラインです」）。APP_SHELL に /, /ipos, /bb, /events, /settings, /offline を事前キャッシュ |
| オフラインの実機挙動 | 未検証 | 機内モードでの表示は未確認 |
| SW 更新 | ✅ | /sw.js は `cache-control: max-age=0, must-revalidate`、install で skipWaiting・activate で clients.claim |
| 初回免責シート | ✅ | `src/components/FirstRunDisclaimer.tsx` を layout.tsx で常時マウント。localStorage `kabu-radar:disclaimer-accepted:v1` 未保存なら表示、「同意して使いはじめる」で保存 |
| 通知許可の導線 | ✅ | 設定 →「プッシュ通知」（`src/components/settings/PushOptIn.tsx`）のスイッチ → `Notification.requestPermission()`（`src/hooks/usePushSubscription.ts`）。ブロック時の案内あり |
| TWA 内での通知許可 | ⚠️ 未検証 | enableNotifications true でビルド済み（Bubblewrap の通知委譲）。Android 13+ では POST_NOTIFICATIONS の OS ダイアログが出る想定だが実機未確認 |

## 5. ビルド成果物

| 項目 | 結果 | 根拠 |
|---|---|---|
| `npm run twa:build` | ✅ | EXIT=0（ログ `scratch/twa-build.log`） |
| APK | ✅ | `android-twa/app-release-signed.apk` 1,076,084 bytes、sha256 dcb3c144…182a24 |
| AAB | ✅ | `android-twa/app-release-bundle.aab` 1,140,691 bytes |
| git 管理外 | ✅ | APK/AAB/keystore/app/gradle 一式は `.gitignore` 対象（`git status --short` に出ない） |
| 色変更後の再ビルド | ⚠️ | 今回の APK は #1F1F1F で焼いている。別セッションの配色変更後に `npm run twa:build` をやり直す必要あり（versionCode は 2 のままで可、配布前なら） |

## 6. 静的チェック

| 項目 | 結果 | 根拠 |
|---|---|---|
| `npx tsc --noEmit` | ✅ | エラーなし |
| `npm run lint` | ✅ | 0 errors（既存の warning 2 件のみ、今回の変更とは無関係） |
