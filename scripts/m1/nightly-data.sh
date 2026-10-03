#!/usr/bin/env bash
# カブレーダー（ipo-analyzer）夜間データ更新ジョブ。専用クローンで実行する前提。
#
# 流れ:
#   0. クローン（.git）があるか確認。無ければロックも状態フォルダも作らず、失敗を通知して終了
#      （クローン先に .m1-state だけの空フォルダを作ってしまうと、導入スクリプトが迷うため）
#   1. 多重起動防止（lockディレクトリ、240分でstale扱い（月初の yutai:data が詳細ページ・決算まわりの取得で 2 時間前後かかるため）。m1-ops の他ジョブに合わせた作法）
#   2. github.com に届くまで待つ（30秒おきに最大10回）→ main を git pull --ff-only
#   3. package-lock.json が変わっていれば npm ci
#   4. npm run update:data → npm run enrich:data → npm run fins:data（J-Quants 財務サマリ。失敗しても続行）→ npm run yutai:data（月に 1 回だけ実処理）→ npm run yutai:refresh（今月＋1・＋2 の日次更新）
#   5. public/data に差分が無ければここで正常終了（AUTO_PUBLISHの分岐に入らない）
#   6. 差分があれば npm run lint && npm test（test は失敗したら1回だけ再実行する。
#      1回目失敗・2回目成功のときは .m1-state/last-flaky に日時と失敗したテスト名を残す）
#   7. push 以降（ブランチ作成→コミット→push→PR作成）は
#      環境変数 AUTO_PUBLISH=1 のときだけ実行。未設定なら差分サマリをログに出して終了（安全側の既定）。
#      マージはジョブでは行わない。人間がスマホ等のGitHubアプリでPRをMergeする
#
# 失敗時の通知:
#   - 本物の Vault（~/ObsidianVault/Plaud があり、Syncthing の .stfolder か .obsidian もある）を
#     持つ機械（M1）は _エラーログ.md に追記する（m1-ops の他ジョブと同じ書式）。
#   - 持たない機械（M3。Vault へ自動で書くのは禁止）は macOS の通知で知らせる。
#     Plaud/ だけの残骸フォルダがあっても、そこには書かない（誰も読まない場所に落ちるため）。
#   どちらの場合もログ（~/Library/Logs/ipo-radar-data.log）に同じ内容を残す。
# 正常終了したら .m1-state/last-success に終了時刻（JST）を書く。
# ネットワーク待ちの回数・間隔は環境変数 IPO_RADAR_NET_WAIT_TRIES（既定10）・IPO_RADAR_NET_WAIT_INTERVAL（既定30秒）で変えられる。
#
# 想定配置: 専用クローン直下 scripts/m1/nightly-data.sh
# M1・M3どちらで動かしても手順は同じ（IPO_RADAR_REPO_DIR の既定は $HOME/apps/ipo-radar）。
# 実行: launchd（com.zukky.ipo-radar-data.plist）から呼ぶか、手動で
#   AUTO_PUBLISH=1 ./scripts/m1/nightly-data.sh
# のように実行する。

set -euo pipefail

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
JOB_NAME="ipo-radar-data"
REPO_DIR="${IPO_RADAR_REPO_DIR:-$HOME/apps/ipo-radar}"
STATE_DIR="$REPO_DIR/.m1-state"
LOCK_DIR="$STATE_DIR/${JOB_NAME}.lock"
LOCK_STALE_MIN=240
LAST_SUCCESS_FILE="$STATE_DIR/last-success"
LAST_FLAKY_FILE="$STATE_DIR/last-flaky"
# test の1回目の出力の置き場（毎回上書き。失敗したテスト名を last-flaky に写すために使う）
TEST_FIRST_RUN_OUT="$STATE_DIR/test-first-run.out"
NET_WAIT_TRIES="${IPO_RADAR_NET_WAIT_TRIES:-10}"
NET_WAIT_INTERVAL_SEC="${IPO_RADAR_NET_WAIT_INTERVAL:-30}"
VAULT_ROOT="$HOME/ObsidianVault"
VAULT_ERROR_LOG="$VAULT_ROOT/Plaud/_エラーログ.md"
ERROR_TAG="[${JOB_NAME}]"
AUTO_PUBLISH="${AUTO_PUBLISH:-0}"
DATA_DIR="public/data"
DATE_JST="$(TZ=Asia/Tokyo date +%Y%m%d)"
DATETIME_JST="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')"
# 同日に再実行しても既存のリモートブランチと衝突しないよう分単位まで含める
BRANCH_NAME="data/$(TZ=Asia/Tokyo date '+%Y%m%d-%H%M')"

# node/npm/gh 等が ~/.local/bin にある前提（m1-server.md の環境に合わせる）
export PATH="$HOME/.local/bin:$PATH"

log() {
  echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 本物の Vault があるか。~/ObsidianVault/Plaud だけが残っている機械（M3 に過去のテストの残骸がある）
# を Vault と取り違えないよう、Syncthing の目印（.stfolder）か Obsidian の設定（.obsidian）も見る。
vault_available() {
  [ -d "$VAULT_ROOT/Plaud" ] && { [ -d "$VAULT_ROOT/.stfolder" ] || [ -d "$VAULT_ROOT/.obsidian" ]; }
}

# 失敗を人に知らせる。ログには必ず残し、あとは Vault のある機械かどうかで分ける。
#   Vault あり（M1）: _エラーログ.md へ追記（m1-ops の他ジョブと同じ書式: - HH:MM [タグ] 内容）
#   Vault なし（M3）: Vault へは書かず、macOS の通知を出す
notify_error() {
  local message="$1"
  local line
  line="- $(TZ=Asia/Tokyo date '+%H:%M') ${ERROR_TAG} ${message}"
  log "失敗: ${line}"
  if vault_available; then
    echo "$line" >> "$VAULT_ERROR_LOG" || true
  else
    log "本物の Vault が無い（${VAULT_ROOT}）ため、Vault へは書かず macOS の通知で知らせる。"
    # AppleScript の文字列を壊す " と \ は除く
    local safe_message="${message//[\"\\]/}"
    osascript -e "display notification \"${safe_message}\" with title \"カブレーダー 夜間ジョブが失敗\"" >/dev/null 2>&1 || true
  fi
}

# 正常終了の目印（JST の日時を1行）。書けなくてもジョブは失敗にしない。
mark_success() {
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S %Z' > "$LAST_SUCCESS_FILE" 2>/dev/null || true
}

# github.com に届くまで待つ。スリープ明けの M3 などでネットワークが戻る前にジョブが走ると
# 「Could not resolve host: github.com」で pull が失敗する（2026-09-30 02:00 に実際に起きた）ため、
# pull の前に git ls-remote で名前解決と接続を確かめ、届かなければ間隔をおいて再試行する。
# 戻り値: 届いた=0 / 上限回数まで試しても届かない=1
wait_for_github() {
  local try=1 err
  while :; do
    # ls-remote は読み取りだけ。認証の入力待ちで固まらないよう対話を切り、通信が止まったら諦めさせる。
    if err="$(GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 \
      ls-remote origin HEAD 2>&1 >/dev/null </dev/null)"; then
      log "github.com への接続を確認（${try}回目）"
      return 0
    fi
    log "github.com に届かない（${try}/${NET_WAIT_TRIES}回目）: $(printf '%s' "$err" | head -n 1)"
    if [ "$try" -ge "$NET_WAIT_TRIES" ]; then
      return 1
    fi
    try=$((try + 1))
    sleep "$NET_WAIT_INTERVAL_SEC"
  done
}

# npm test が1回目に失敗して再実行で通ったことを .m1-state/last-flaky に残す（ログだけだと流れて気づけないため）。
# 書けなくてもジョブは失敗にしない。
record_flaky() {
  local names
  names="$(grep -E '^[[:space:]]*FAIL[[:space:]]' "$TEST_FIRST_RUN_OUT" 2>/dev/null | sed 's/^[[:space:]]*//' | sort -u | head -n 10 || true)"
  {
    echo "$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S %Z') npm test は1回目に失敗し、再実行で通過した"
    if [ -n "$names" ]; then
      echo "1回目に失敗したテスト:"
      printf '%s\n' "$names" | sed 's/^/  /'
    else
      echo "（失敗したテスト名を読み取れなかった。1回目の出力の保存先: ${TEST_FIRST_RUN_OUT}）"
    fi
  } > "$LAST_FLAKY_FILE" 2>/dev/null || true
  log "1回目の失敗を ${LAST_FLAKY_FILE} に記録した"
}

on_error() {
  local exit_code=$?
  local line=${BASH_LINENO[0]:-0}
  notify_error "異常終了（exit=${exit_code}, line=${line}）。ログ: ~/Library/Logs/${JOB_NAME}.log"
  release_lock
  exit "$exit_code"
}
trap on_error ERR

release_lock() {
  # ロック内に pid / started_at を置いているので、先に消さないと rmdir が失敗する
  rm -f "$LOCK_DIR/pid" "$LOCK_DIR/started_at" 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    date +%s > "$LOCK_DIR/started_at" 2>/dev/null || true
    return 0
  fi

  # 既存ロックがstale（240分超）なら奪い取る。生きていれば多重起動として終了。
  local started_at now age_min
  started_at="$(cat "$LOCK_DIR/started_at" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  age_min=$(( (now - started_at) / 60 ))
  if [ "$age_min" -ge "$LOCK_STALE_MIN" ]; then
    log "既存ロックが${age_min}分経過（stale扱い）。奪って続行する。"
    release_lock
    mkdir "$LOCK_DIR"
    echo "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    date +%s > "$LOCK_DIR/started_at" 2>/dev/null || true
    return 0
  fi

  log "多重起動を検知（ロック経過${age_min}分 < ${LOCK_STALE_MIN}分）。今回はスキップして終了する。"
  exit 0
}

# ---------------------------------------------------------------------------
# 本体
# ---------------------------------------------------------------------------
log "=== ${JOB_NAME} 開始 ==="
log "環境: host=$(hostname) user=$(id -un) node=$(node -v 2>/dev/null || echo 不明) AUTO_PUBLISH=${AUTO_PUBLISH}"

# クローンの有無はロックより先に確かめる。acquire_lock は状態フォルダ（.m1-state）を作るので、
# クローンが無いまま先に進むと、クローン先に .m1-state だけのフォルダが残ってしまう。
# ここで抜ける時点ではロックも状態フォルダも作っていないので、片付ける物は無い。
if [ ! -d "$REPO_DIR/.git" ]; then
  notify_error "クローンが見つからない（${REPO_DIR}）。README.md の手順でセットアップしてください。"
  exit 1
fi

acquire_lock

cd "$REPO_DIR"

log "HEAD（pull前）: $(git log -1 --format='%h %s' 2>/dev/null || echo 不明)"
log "github.com に届くか確認する（届かなければ${NET_WAIT_INTERVAL_SEC}秒おきに最大${NET_WAIT_TRIES}回まで）"
if ! wait_for_github; then
  notify_error "github.com に届かない（${NET_WAIT_TRIES}回試して約$(( (NET_WAIT_TRIES - 1) * NET_WAIT_INTERVAL_SEC ))秒待った）。スリープ明け等でネットワークが戻っていない可能性。回線を確認して、手動で再実行してください。"
  release_lock
  exit 1
fi
log "git pull --ff-only（main）"
# 前回 AUTO_PUBLISH 未設定・lint/test 失敗で残したデータ差分は毎回作り直すので捨てる
# （残したままだと upstream の public/data 更新と衝突して pull が失敗する）。専用クローンなので安全。
git restore --worktree --staged -- "$DATA_DIR"
git checkout main
HEAD_BEFORE_PULL="$(git rev-parse HEAD)"
git fetch origin main
if ! git pull --ff-only origin main; then
  notify_error "git pull --ff-only に失敗（ローカルmainがずれている可能性）。手動で確認してください。"
  release_lock
  exit 1
fi
HEAD_AFTER_PULL="$(git rev-parse HEAD)"
log "HEAD（pull後）: $(git log -1 --format='%h %s')"

# pull前後のコミット範囲でpackage-lock.jsonが変わったかを見る
CHANGED_LOCKFILE=0
if [ "$HEAD_BEFORE_PULL" != "$HEAD_AFTER_PULL" ]; then
  if git diff --name-only "$HEAD_BEFORE_PULL" "$HEAD_AFTER_PULL" -- package-lock.json | grep -q package-lock.json; then
    CHANGED_LOCKFILE=1
  fi
fi
# 初回セットアップ等、node_modulesがまだ無いときも安全側でnpm ciする
if [ ! -d node_modules ]; then
  CHANGED_LOCKFILE=1
fi

if [ "$CHANGED_LOCKFILE" = "1" ]; then
  log "package-lock.json 変更を検知 → npm ci"
  npm ci
else
  log "package-lock.json 変更なし → npm ci はスキップ"
fi

log "npm run update:data"
npm run update:data

log "npm run enrich:data"
npm run enrich:data

# 財務サマリ（public/data/fins.json。J-Quants 無料枠は約 12 週遅延。前回キャッシュの翌日から最大 60 日ぶんを 13 秒間隔で取る）
# 失敗しても続行する（既存の fins.json のまま。翌日に取り直せばよい）
log "npm run fins:data"
if ! npm run fins:data; then
  log "fins:data が失敗したが続行する（既存の public/data/fins.json のまま）"
fi

# 株主優待（public/data/yutai/ の index.json と月別ファイル）。月足・日足は月末にしか変わらないので、今月作成済みなら中で即スキップする
# 月の最初の実行だけ、月足（約 1,700 銘柄・400ms 間隔）と日足（同・1 秒間隔）を取るため 45〜60 分かかる
# 失敗しても IPO データの更新・公開は続ける（優待は月 1 回の更新で、翌日に取り直せばよい）
log "npm run yutai:data"
if ! npm run yutai:data; then
  log "yutai:data が失敗したが続行する（既存の public/data/yutai/ のまま）"
fi

# 株主優待の日次更新（今月＋1・今月＋2 の権利月だけ。現在値まわりを日足で取り直し、決算発表予定日は週 1 回更新して除外ルールを再適用）
# 約 600〜800 銘柄・1 秒間隔で 15 分前後。失敗しても続行する
log "npm run yutai:refresh"
if ! npm run yutai:refresh; then
  log "yutai:refresh が失敗したが続行する（現在値まわりは前回のまま）"
fi

# public/data の差分確認
if git diff --quiet -- "$DATA_DIR" && git diff --cached --quiet -- "$DATA_DIR"; then
  log "public/data に差分なし。正常終了。"
  mark_success
  release_lock
  log "=== ${JOB_NAME} 終了（差分なし） ==="
  exit 0
fi

CHANGED_FILES="$(git diff --name-only -- "$DATA_DIR")"
log "public/data に差分あり:"
echo "$CHANGED_FILES" | sed 's/^/  - /'

log "npm run lint"
if ! npm run lint; then
  notify_error "lint失敗。データ差分は未コミットのまま作業ツリーに残しています（${REPO_DIR}）。"
  release_lock
  exit 1
fi

log "npm test"
# 1回目の出力は画面（ログ）に流しながらファイルにも写す。書けなければ /dev/null に捨てるだけでジョブは続ける。
: > "$TEST_FIRST_RUN_OUT" 2>/dev/null || TEST_FIRST_RUN_OUT=/dev/null
if ! npm test 2>&1 | tee "$TEST_FIRST_RUN_OUT"; then
  # 夜間の負荷でタイムアウトすることがあるため、1回だけ再実行する（2回とも失敗したら失敗扱い）
  log "npm test が失敗。1回だけ再実行する"
  if ! npm test; then
    notify_error "test失敗（再実行も失敗）。データ差分は未コミットのまま作業ツリーに残しています（${REPO_DIR}）。"
    release_lock
    exit 1
  fi
  log "npm test は再実行で通過"
  record_flaky
fi

log "lint/test 通過。差分サマリ:"
echo "$CHANGED_FILES" | sed 's/^/  - /'

if [ "$AUTO_PUBLISH" != "1" ]; then
  log "AUTO_PUBLISH が未設定（現在: '${AUTO_PUBLISH}'）のため、ここで終了する。push/PRは行わない。"
  log "手動で取り込む場合は ${REPO_DIR} の作業ツリーの変更を確認してください（次回起動でpullし直され上書きされる点に注意）。"
  mark_success
  release_lock
  log "=== ${JOB_NAME} 終了（AUTO_PUBLISH未設定） ==="
  exit 0
fi

log "AUTO_PUBLISH=1 のため公開フローへ進む"

git checkout -B "$BRANCH_NAME"  # ブランチ名は分単位だが、念のため既存ブランチがあっても -B で上書き
git add "$DATA_DIR"

COMMIT_MSG="chore: IPOデータ自動更新（${DATE_JST}）

$(echo "$CHANGED_FILES" | sed 's/^/- /')"

git commit -m "$COMMIT_MSG"

log "git push"
# credential.helper= で一度リセットしてから gh の認証で push する（M3 は gh auth git-credential 経由）
if ! git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin "$BRANCH_NAME"; then
  notify_error "git push に失敗（${BRANCH_NAME}）。GitHub認証（gh auth status）を確認してください。ブランチはローカルに残しています。"
  git checkout main
  release_lock
  exit 1
fi

log "gh pr create"
PR_URL="$(gh pr create \
  --title "chore: IPOデータ自動更新（${DATE_JST}）" \
  --body "夜間ジョブ（nightly-data.sh）による自動更新。差分:
$(echo "$CHANGED_FILES" | sed 's/^/- /')

実行日時: ${DATETIME_JST} JST

スマホの GitHub アプリ（または PC）でこの PR を Merge すると、約2分で本番に反映されます。
🤖 Generated by nightly-data.sh" \
  --base main \
  --head "$BRANCH_NAME" 2>&1)" || {
  notify_error "gh pr create に失敗。ブランチ ${BRANCH_NAME} はpush済み。手動でPR作成してください。"
  git checkout main
  release_lock
  exit 1
}
log "PR作成: $PR_URL"

# 前回以前の自動更新PR（head が data/ で始まる open PR）は今回のPRに役目を譲るので閉じる。
# 失敗してもジョブ自体は失敗扱いにしない（ERRトラップに引っかからないよう if で握る）。
log "古い自動更新PRの整理"
OLD_PR_NUMBERS=""
if OLD_PR_NUMBERS="$(gh pr list --state open --json number,headRefName \
  --jq '.[] | select(.headRefName | startswith("data/")) | select(.headRefName != "'"$BRANCH_NAME"'") | .number' 2>&1)"; then
  if [ -n "$OLD_PR_NUMBERS" ]; then
    while IFS= read -r old_pr_number; do
      [ -n "$old_pr_number" ] || continue
      if gh pr close "$old_pr_number" --comment "新しい自動更新 PR（${PR_URL}）に置き換えたため閉じます" 2>&1; then
        log "古いPR #${old_pr_number} を閉じた"
      else
        log "警告: 古いPR #${old_pr_number} を閉じられなかった（手動確認してください）"
      fi
    done <<< "$OLD_PR_NUMBERS"
  else
    log "閉じるべき古い自動更新PRなし"
  fi
else
  log "警告: 古い自動更新PRの一覧取得に失敗した（手動確認してください）: ${OLD_PR_NUMBERS}"
fi

git checkout main

osascript -e 'display notification "データ更新のPRができました。GitHubアプリでMergeしてください" with title "カブレーダー"' >/dev/null 2>&1 || true

mark_success
release_lock
log "=== ${JOB_NAME} 終了（PR作成: ${PR_URL}｜マージ待ち） ==="
