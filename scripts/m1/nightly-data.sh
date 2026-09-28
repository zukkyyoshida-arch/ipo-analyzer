#!/usr/bin/env bash
# IPO Radar（ipo-analyzer）夜間データ更新ジョブ。M1専用クローンで実行する前提。
#
# 流れ:
#   1. 多重起動防止（lockディレクトリ、90分でstale扱い。m1-ops の他ジョブに合わせた作法）
#   2. main を git pull --ff-only
#   3. package-lock.json が変わっていれば npm ci
#   4. npm run update:data → npm run enrich:data
#   5. public/data に差分が無ければここで正常終了（AUTO_PUBLISHの分岐に入らない）
#   6. 差分があれば npm run lint && npm test
#   7. push 以降（ブランチ作成→コミット→push→PR作成→自動マージ）は
#      環境変数 AUTO_PUBLISH=1 のときだけ実行。未設定なら差分サマリをログに出して終了（安全側の既定）
#
# 失敗時は Obsidian Vault の _エラーログ.md に追記する（m1-ops の他ジョブと同じ書式）。
#
# 想定配置: M1側の専用クローン直下 scripts/m1/nightly-data.sh
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
LOCK_STALE_MIN=90
VAULT_ERROR_LOG="$HOME/ObsidianVault/Plaud/_エラーログ.md"
ERROR_TAG="[${JOB_NAME}]"
AUTO_PUBLISH="${AUTO_PUBLISH:-0}"
DATA_DIR="public/data"
DATE_JST="$(TZ=Asia/Tokyo date +%Y%m%d)"
DATETIME_JST="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')"
BRANCH_NAME="data/${DATE_JST}"

# node/npm/gh 等が ~/.local/bin にある前提（m1-server.md の環境に合わせる）
export PATH="$HOME/.local/bin:$PATH"

log() {
  echo "[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Vaultのエラーログへ追記（m1-ops の他ジョブと同じ書式: - HH:MM [タグ] 内容）
notify_error() {
  local message="$1"
  local line
  line="- $(TZ=Asia/Tokyo date '+%H:%M') ${ERROR_TAG} ${message}"
  if [ -d "$(dirname "$VAULT_ERROR_LOG")" ]; then
    echo "$line" >> "$VAULT_ERROR_LOG" || true
  else
    log "警告: Vaultへ書けなかった（$VAULT_ERROR_LOG が無い）。本来の内容: $line"
  fi
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
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    date +%s > "$LOCK_DIR/started_at" 2>/dev/null || true
    return 0
  fi

  # 既存ロックがstale（90分超）なら奪い取る。生きていれば多重起動として終了。
  local started_at now age_min
  started_at="$(cat "$LOCK_DIR/started_at" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  age_min=$(( (now - started_at) / 60 ))
  if [ "$age_min" -ge "$LOCK_STALE_MIN" ]; then
    log "既存ロックが${age_min}分経過（stale扱い）。奪って続行する。"
    rm -rf "$LOCK_DIR"
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
acquire_lock

if [ ! -d "$REPO_DIR/.git" ]; then
  notify_error "クローンが見つからない（${REPO_DIR}）。README.md の手順でセットアップしてください。"
  release_lock
  exit 1
fi

cd "$REPO_DIR"

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

# public/data の差分確認
if git diff --quiet -- "$DATA_DIR" && git diff --cached --quiet -- "$DATA_DIR"; then
  log "public/data に差分なし。正常終了。"
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
if ! npm test; then
  notify_error "test失敗。データ差分は未コミットのまま作業ツリーに残しています（${REPO_DIR}）。"
  release_lock
  exit 1
fi

log "lint/test 通過。差分サマリ:"
echo "$CHANGED_FILES" | sed 's/^/  - /'

if [ "$AUTO_PUBLISH" != "1" ]; then
  log "AUTO_PUBLISH が未設定（現在: '${AUTO_PUBLISH}'）のため、ここで終了する。push/PR/mergeは行わない。"
  log "手動で取り込む場合は ${REPO_DIR} の作業ツリーの変更を確認してください（次回起動でpullし直され上書きされる点に注意）。"
  release_lock
  log "=== ${JOB_NAME} 終了（AUTO_PUBLISH未設定） ==="
  exit 0
fi

log "AUTO_PUBLISH=1 のため公開フローへ進む"

git checkout -B "$BRANCH_NAME"  # 同日の再実行でもブランチ作成で落ちないよう -B
git add "$DATA_DIR"

COMMIT_MSG="chore: IPOデータ自動更新（${DATE_JST}）

$(echo "$CHANGED_FILES" | sed 's/^/- /')"

git commit -m "$COMMIT_MSG"

log "git push"
if ! git push -u origin "$BRANCH_NAME"; then
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
🤖 Generated with M1 nightly job" \
  --base main \
  --head "$BRANCH_NAME" 2>&1)" || {
  notify_error "gh pr create に失敗。ブランチ ${BRANCH_NAME} はpush済み。手動でPR作成してください。"
  git checkout main
  release_lock
  exit 1
}
log "PR作成: $PR_URL"

log "gh pr merge --squash --delete-branch"
if ! gh pr merge "$BRANCH_NAME" --squash --delete-branch 2>&1; then
  notify_error "gh pr merge に失敗。PR: ${PR_URL} 。手動マージしてください。"
  git checkout main
  release_lock
  exit 1
fi

git checkout main
git pull --ff-only origin main || true

release_lock
log "=== ${JOB_NAME} 終了（公開完了: ${PR_URL}） ==="
