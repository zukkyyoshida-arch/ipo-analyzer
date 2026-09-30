# カブナビ 夜間データ更新ジョブ

`nightly-data.sh` が専用クローン（既定 `~/apps/ipo-radar`）で毎日 2:00 に IPO データ（`public/data/*.json`）を更新する。
差分があれば lint・test を通し、ブランチを push して PR を作る（**マージは人間**。GitHub アプリで Merge すると約2分で本番に反映）。
導入・取り外しは `install.sh` の1本で済む。

## M1 が復旧したらやること

前提: このブランチの変更が main にマージ済み（M1 には main の内容が入る）。コマンドは M3 の作業用クローン（`~/ipo-analyzer`）で実行する。

1. **点検**（何も変更しない）。❌ が出たら下の「点検で ❌ が出たとき」で直して、もう一度流す。

   ```bash
   ssh m1 'bash -s' -- --check --publish < scripts/m1/install.sh
   ```

2. **導入して1回動かす**。M1 にクローン・`npm ci`・plist・launchd 登録までして、すぐ1回実行しログ末尾を見せる（数分〜十数分かかる）。
   差分があれば本当にブランチを push して PR を作る（マージはしない）。

   ```bash
   ssh m1 'bash -s' -- --publish --run-now < scripts/m1/install.sh
   ```

3. **M3 のつなぎジョブを外す**。②が通って PR ができたのを確かめたら、**同じ日のうちに**外す（両方で動かすと同日に PR が二重にできる）。
   M3 のクローンと plist は削除せず、plist は `~/Library/LaunchAgents/retired/` へ日時付きで移る。

   ```bash
   bash scripts/m1/install.sh --uninstall     # M3 で実行
   ```

## install.sh の使い方

| コマンド | 内容 |
|---|---|
| `install.sh --check` | 前提条件の点検だけ（✅/⚠️/❌ の一覧。❌ があれば非ゼロ終了） |
| `install.sh` | 点検 → 導入（❌ があれば導入せず終了）。AUTO_PUBLISH は無効＝ログに差分サマリを出すだけの安全側 |
| `install.sh --publish` | AUTO_PUBLISH=1 で導入（push と PR 作成まで）。gh・git の設定も点検する |
| `install.sh --run-now` | 導入後に `launchctl kickstart` で1回実行し、今回分のログ末尾を表示する |
| `install.sh --uninstall` | `bootout` して plist を `retired/` へ移す（削除はしない） |

何度実行しても同じ結果になる。plist が変わらず登録済みなら再登録もしない。変わるときは既存を `.bak-YYYYMMDD-HHMM` に退避する。
ジョブが実行中のときは、止めてしまうので導入も取り外しも断る。クローン先を変えるときは環境変数 `IPO_RADAR_REPO_DIR`（plist にも反映される）。

## 点検で ❌ が出たとき

- **node の版**: `.node-version`（22）の主バージョンに合わせる。Homebrew なしなので、Node の公式 tar.gz を展開して `bin/` の中身を `~/.local/bin` に置く。
- **gh が無い**（`--publish` のとき）: 公式リリースから `~/.local/bin` に入れる。点検が機種に合わせた手順を表示する（自動ダウンロードはしない）。
  最新版は <https://github.com/cli/cli/releases/latest> で確認し、`gh_<VER>_macOS_arm64.zip` の `bin/gh` を `~/.local/bin/` へコピーする。
- **gh が未認証**: M1 の対話端末（`ssh -t m1`）で `gh auth login -h github.com -p https -w`。表示されるコードをブラウザで承認する。
  このリポジトリ（zukkyyoshida-arch/ipo-analyzer）へ書き込める権限のアカウントで入る。トークンをチャットやファイルに書かない。
- **git の user.name / user.email**: `git config --global user.name "Kazuki Yoshida"` と `git config --global user.email "<GitHub のメール>"`。
- **gui/501 が使えない**: M1 のユーザー zukky が GUI にログインしていない。M1 の画面でログインしたままにする。
- **作業ツリーに未コミットの変更**: 専用クローンには手を入れない運用。中身を見て要らなければ戻す。`public/data` の差分だけは夜間ジョブが毎回捨てるので許容される。
- **ネットワーク**: github.com か Yahoo Finance に届かない。M1 の回線・DNS を確認する。

任意: EDINET を使うなら `~/apps/ipo-radar/.env` に `EDINET_API_KEY=...` を1行書く（無ければ EDINET の取得だけスキップされる）。

## 日々の運用

- 毎朝、GitHub アプリ（または PC）の Pull requests から「IPOデータ自動更新」を開いて **Merge**。古い自動更新 PR は新しい PR ができたときにジョブが閉じる。
- 動いたかの確認: `cat ~/apps/ipo-radar/.m1-state/last-success`（最後に正常終了した JST の日時）。詳しくは `~/Library/Logs/ipo-radar-data.log`。
- テストが1回目に失敗して再実行で通った夜は、`cat ~/apps/ipo-radar/.m1-state/last-flaky`（日時と1回目に失敗したテスト名。最新の1回分だけ残る）。
  1回目の出力そのものは `.m1-state/test-first-run.out`（毎晩上書き）。同じテストが何度も出るなら、夜間の負荷に弱いテストなので軽くする。
- 起動時のログにホスト名・node の版・HEAD のコミットが出る。`npm test` が失敗したら1回だけ再実行し、2回とも失敗したら失敗扱いになる。
- AUTO_PUBLISH の切替は `install.sh` を `--publish` の有無を変えて流し直す。
- `AUTO_PUBLISH=1` の稼働中に、クローンの作業ツリーへ手作業の変更を残さない（次回の `git pull --ff-only` で失敗する）。

## 失敗の通知先

| 機械 | 通知 |
|---|---|
| M1 | Vault の `Plaud/_エラーログ.md` に `- HH:MM [ipo-radar-data] 内容` を追記（他のジョブと同じ書式） |
| M3 | macOS の通知（Vault には自動で書かない運用）。どちらもログに同じ内容が残る |

Vault があるかは、`~/ObsidianVault/Plaud` に加えて Syncthing の `.stfolder` か `.obsidian` があるかで見分ける。
`Plaud/` だけが残っている機械（M3）では、そこには書かず macOS の通知に回す。

## メモ

- 起動時に github.com へ届くかを `git ls-remote` で確かめ、届かなければ 30秒おきに最大10回（約4.5分）待ってから `git pull` に進む。
  スリープ明けでネットワークが戻っていない時刻に走っても失敗しないため（2026-09-30 に M3 で `Could not resolve host: github.com` が出た）。
  待っても届かなければ失敗として通知して終了する。回数と間隔は環境変数 `IPO_RADAR_NET_WAIT_TRIES`・`IPO_RADAR_NET_WAIT_INTERVAL`（秒）で変えられる。
- クローンが無い（plist を残したままクローンを消した・移した等）とき、ジョブは `.m1-state` などのフォルダを作らずに失敗を通知して終了する。
  旧版のジョブがクローン先に `.m1-state` だけのフォルダを残していても、`install.sh` は空フォルダと同じ扱いで、中身をそのままにクローンして導入できる。
- スケジュールは 2:00（就寝帯内で、3:00 のバックアップ等と重ならない）。plist は `ProcessType=Standard` で、夜間に CPU・I/O を絞られてテストが遅れるのを避ける。
- M3 はノートなので、2:00 にスリープ・停止していると実行されない（起きたときに1回走る）。
- このジョブは Ollama を使わないので、他の Ollama ジョブと時刻が重なっても競合しない。
- ログは `~/Library/Logs/ipo-radar-data.log`（M1 では `com.zukky.log-rotate` がローテーションする）。
