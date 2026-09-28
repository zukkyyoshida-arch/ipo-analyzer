# IPO Radar 夜間データ更新ジョブ（M1）

`nightly-data.sh` は M1 上の専用クローンで IPO データ（`public/data/*.json`）を
毎晩自動更新するスクリプト。plist は用意するだけで、**load（登録）は本人が明示的に行う**。

## 設置手順

### 1. 専用クローンを作る

```bash
ssh m1
mkdir -p ~/apps
git clone https://github.com/zukkyyoshida-arch/ipo-analyzer.git ~/apps/ipo-radar
cd ~/apps/ipo-radar
```

### 2. .env を配置

EDINET_API_KEY を使う場合のみ、`~/apps/ipo-radar/.env` に1行追記する（他の変数は不要）。

```
EDINET_API_KEY=xxxxxxxx
```

キーが無い場合は `.env` を置かなくてもよい（EDINET関連の取得だけスキップされる）。

### 3. 初回セットアップ

```bash
cd ~/apps/ipo-radar
npm ci
```

### 4. スクリプトが正しい場所にあるか確認

`scripts/m1/nightly-data.sh` はリポジトリに含まれているので clone した時点で既に存在する
（このPRがmainにマージされた後の話。マージ前に検証する場合は該当ブランチを scp/checkout する）。

### 5. 手動で1回試す（AUTO_PUBLISH未設定＝安全側）

```bash
cd ~/apps/ipo-radar
./scripts/m1/nightly-data.sh
tail -50 ~/Library/Logs/ipo-radar-data.log
```

差分が無ければそのまま正常終了、差分があれば lint/test まで実行してログにサマリが出る。
この段階では push も PR も作らない。

### 6. plist をコピーして load する（本人 or 明示承認後にAIが実行）

```bash
cp ~/apps/ipo-radar/scripts/m1/com.zukky.ipo-radar-data.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.zukky.ipo-radar-data.plist
# 検証: 手動で一度キック
launchctl kickstart -k gui/501/com.zukky.ipo-radar-data
tail -50 ~/Library/Logs/ipo-radar-data.log
```

### 7. AUTO_PUBLISH を有効にする（push・PR作成まで自動化する場合のみ）

plist の `EnvironmentVariables` にある `AUTO_PUBLISH` のコメントを外して `1` にし、再読込する。
マージ（本番反映）はこのジョブでは行わない。PRができたら人間がスマホのGitHubアプリ（またはPC）で
Mergeする運用（マージ後、約2分でDeployワークフローが本番に反映する）。

```bash
# plist を編集後
launchctl bootout gui/501/com.zukky.ipo-radar-data
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.zukky.ipo-radar-data.plist
```

未設定（既定）のままなら、スクリプトは lint/test まで実行して差分サマリをログに出すだけで終了し、
push・PR作成は一切行わない。

## GitHub認証（gh）

`AUTO_PUBLISH=1` で push / PR作成まで自動化する場合、M1に GitHub への書き込み権限が必要
（マージはジョブでは行わず、人間がスマホ等のGitHubアプリで行う）。

```bash
ssh m1
gh auth status   # 未認証なら
gh auth login    # ブラウザ or トークンで認証（このリポジトリは public）
ssh -T git@github.com   # git push 用の鍵認証も確認
```

`gh auth status` が失敗する場合は、`gh auth login` を M1 本体（または ssh 経由）で実行し、
このリポジトリ（zukkyyoshida-arch/ipo-analyzer）への push 権限があるアカウントでログインする。

## 失敗時の通知

Vault `Plaud/_エラーログ.md` に `[ipo-radar-data]` タグで追記される（m1-ops の他ジョブと同じ書式）。
ログ本体は `~/Library/Logs/ipo-radar-data.log`（`com.zukky.log-rotate` が自動でローテーションする）。

## 注意

- `REPO_DIR` は既定 `~/apps/ipo-radar`。変えたい場合は環境変数 `IPO_RADAR_REPO_DIR` を plist に追加する。
- このジョブは Ollama を使わないため、他のOllama利用ジョブ（qwen3系）と時刻が重なっても競合しない。
- `AUTO_PUBLISH=1` 稼働中に手動で作業ツリーに変更を残さないこと（次回 `git pull --ff-only` で
  コンフリクトし失敗扱いになる）。

## M3 で一時的に動かす（M1 復旧までのつなぎ）

M1 が故障中の間、同じジョブを M3（メインMac）でも launchd で動かせる。M1 と同じく
**専用クローン `~/apps/ipo-radar` を使う**（作業用の `~/ipo-analyzer` は使わない。ジョブが
`git restore` / `git checkout main` するため）。`~/Documents` 配下は launchd から触ると
macOS の権限（TCC）で弾かれることがあるので避ける。

### 手順

```bash
mkdir -p ~/apps
git clone https://github.com/zukkyyoshida-arch/ipo-analyzer.git ~/apps/ipo-radar
cd ~/apps/ipo-radar
npm ci
```

plist の設置は次の1コマンドで（ユーザー名の置換と AUTO_PUBLISH の有効化を同時に行う）。

```bash
sed -e "s#/Users/zukky#$HOME#g" -e 's#<!-- <key>AUTO_PUBLISH</key><string>1</string> -->#<key>AUTO_PUBLISH</key><string>1</string>#' \
  ~/apps/ipo-radar/scripts/m1/com.zukky.ipo-radar-data.plist > ~/Library/LaunchAgents/com.zukky.ipo-radar-data.plist
plutil -lint ~/Library/LaunchAgents/com.zukky.ipo-radar-data.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.zukky.ipo-radar-data.plist
launchctl kickstart -k gui/$(id -u)/com.zukky.ipo-radar-data
tail -50 ~/Library/Logs/ipo-radar-data.log
```

- M3 はノートなので、2:00 JST に本体がスリープ・シャットダウンしていたら実行されない。
  起きたとき（ログイン・スリープ解除）に1回だけ走る（launchd の仕様）。
- M1 が復旧したら、M3 側は必ず外す（M1 と M3 の両方で動かすと同じ日に PR が二重にできる）。

```bash
launchctl bootout gui/$(id -u)/com.zukky.ipo-radar-data
rm ~/Library/LaunchAgents/com.zukky.ipo-radar-data.plist
```

### 毎朝の運用

Mac の通知センター、または GitHub アプリの「Pull requests」タブから「IPOデータ自動更新」の
PR を開いて Merge する。古い自動更新 PR は、新しい PR ができたときにジョブが自動で閉じる
（`--delete-branch` は付けないので、ブランチ自体は残る）。
