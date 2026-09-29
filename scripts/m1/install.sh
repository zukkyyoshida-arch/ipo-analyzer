#!/usr/bin/env bash
# IPO Radar 夜間データ更新ジョブの導入スクリプト（M1 が本番、M3 でも同じように動く）。
#
# 使い方:
#   ./scripts/m1/install.sh --check                 前提条件の点検だけ（何も変更しない）
#   ./scripts/m1/install.sh                         点検 → 導入（❌ があれば導入せず終了）
#   ./scripts/m1/install.sh --publish               導入する plist で AUTO_PUBLISH=1 にする（push と PR 作成まで。マージはしない）
#   ./scripts/m1/install.sh --publish --run-now     導入後に1回実行してログ末尾を表示する
#   ./scripts/m1/install.sh --uninstall             launchd から外し、plist を ~/Library/LaunchAgents/retired/ へ移す（削除はしない）
#
# クローン前でも、M3 から標準入力で流せる（plist の雛形は導入時にクローンから読む）:
#   ssh m1 'bash -s' -- --check < scripts/m1/install.sh
#   ssh m1 'bash -s' -- --publish --run-now < scripts/m1/install.sh
#
# 環境変数:
#   IPO_RADAR_REPO_DIR   クローン先（既定: $HOME/apps/ipo-radar）
#   IPO_RADAR_REPO_URL   クローン元（既定: GitHub の zukkyyoshida-arch/ipo-analyzer）
#
# 何度実行しても同じ結果になる（冪等）。plist が変わらず登録済みなら再登録もしない。
# bash 3.2（macOS 標準）で動くように書いてある。
#
# 標準入力で流されても、本体を main() にまとめ、最終行で呼ぶ。こうしておくと、途中で標準入力を読む
# コマンド（npm・git 等）がスクリプトの続きを食べる事故が起きない。

set -euo pipefail

# node/npm/gh は ~/.local/bin にある前提（Homebrew なし環境）。先頭に足してから探す。
export PATH="$HOME/.local/bin:$PATH"

LABEL="com.zukky.ipo-radar-data"
REPO_URL="${IPO_RADAR_REPO_URL:-https://github.com/zukkyyoshida-arch/ipo-analyzer.git}"
REPO_DIR="${IPO_RADAR_REPO_DIR:-$HOME/apps/ipo-radar}"
DEFAULT_REPO_DIR="$HOME/apps/ipo-radar"
PLIST_TEMPLATE_REL="scripts/m1/${LABEL}.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST_PLIST="$LAUNCH_AGENTS_DIR/${LABEL}.plist"
RETIRED_DIR="$LAUNCH_AGENTS_DIR/retired"
LOG_FILE="$HOME/Library/Logs/ipo-radar-data.log"
VAULT_ROOT="$HOME/ObsidianVault"
GUI_DOMAIN="gui/$(id -u)"
# plist が launchd のジョブに渡す PATH（テンプレートと同じ並び）。ここで見えない道具はジョブから使えない。
JOB_PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DEFAULT_NODE_MAJOR=22
STALE_LOCK_MIN=90
RUN_NOW_TIMEOUT_SEC="${IPO_RADAR_RUN_NOW_TIMEOUT:-1800}"
CURL_UA="Mozilla/5.0 (Macintosh) ipo-radar-install"

CHECK_ONLY=0
PUBLISH=0
RUN_NOW=0
UNINSTALL=0
N_OK=0
N_WARN=0
N_NG=0
# check_repo が決める: absent（無い）/ empty（空フォルダ）/ stateonly（.m1-state だけ入ったフォルダ）/ notgit / present
REPO_STATE="absent"
REPO_DATA_DIFF=0
PLIST_CHANGED=1

# ---------------------------------------------------------------------------
# 表示まわり
# ---------------------------------------------------------------------------
say() { printf '%s\n' "$*"; }
ok() { printf '  ✅ %s\n' "$*"; N_OK=$((N_OK + 1)); }
warn() { printf '  ⚠️  %s\n' "$*"; N_WARN=$((N_WARN + 1)); }
ng() { printf '  ❌ %s\n' "$*"; N_NG=$((N_NG + 1)); }
hint() { printf '       %s\n' "$*"; }
section() { printf '\n[%s]\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }
stamp() { TZ=Asia/Tokyo date '+%Y%m%d-%H%M'; }

usage() {
  cat <<'EOF'
IPO Radar 夜間ジョブ 導入スクリプト

  install.sh --check                 前提条件の点検だけ（何も変更しない）
  install.sh                         点検 → 導入（❌ があれば導入せず終了）
  install.sh --publish               AUTO_PUBLISH=1 で導入（push と PR 作成まで。マージはしない）
  install.sh --run-now               導入後に launchctl kickstart で1回実行し、ログ末尾を表示する
  install.sh --uninstall             bootout して plist を ~/Library/LaunchAgents/retired/ へ移す

  ssh m1 'bash -s' -- --check < scripts/m1/install.sh     （M3 から標準入力で流す）

環境変数: IPO_RADAR_REPO_DIR（クローン先。既定 ~/apps/ipo-radar）
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --check) CHECK_ONLY=1 ;;
      --publish) PUBLISH=1 ;;
      --run-now) RUN_NOW=1 ;;
      --uninstall) UNINSTALL=1 ;;
      -h | --help) usage; exit 0 ;;
      *) die "知らないオプション: $1（--help で一覧）" ;;
    esac
    shift
  done
  if [ "$UNINSTALL" = "1" ] && { [ "$CHECK_ONLY" = "1" ] || [ "$PUBLISH" = "1" ] || [ "$RUN_NOW" = "1" ]; }; then
    die "--uninstall は他のオプションと一緒に使えません"
  fi
  if [ "$CHECK_ONLY" = "1" ] && [ "$RUN_NOW" = "1" ]; then
    die "--check は何も変更しないので --run-now とは一緒に使えません"
  fi
}

# ---------------------------------------------------------------------------
# launchd の状態
# ---------------------------------------------------------------------------
# launchctl print の出力は変数に受けてから grep する（pipefail 下で grep -q の早期終了が失敗扱いになるのを避ける）
job_print() { launchctl print "$GUI_DOMAIN/$LABEL" 2>/dev/null || true; }
job_loaded() { launchctl print "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1; }
job_running() {
  local out
  out="$(job_print)"
  printf '%s\n' "$out" | grep -Eq '^[[:space:]]*state = running'
}

# ---------------------------------------------------------------------------
# plist の生成（導入と検証の両方から使う）
#   render_plist <雛形> <出力先> <publish:0|1> <クローン先>
#   ・雛形の /Users/zukky（M1 のホーム）を $HOME に置き換える
#   ・クローン先が既定と違えば、実行パスを差し替えて IPO_RADAR_REPO_DIR も渡す
#   ・publish=1 なら AUTO_PUBLISH のコメントを外して有効にする
# ---------------------------------------------------------------------------
xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
sed_escape() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }

render_plist() {
  local template="$1" out="$2" publish="$3" repo_dir="$4"
  local home_x repo_x
  home_x="$(sed_escape "$(xml_escape "$HOME")")"
  repo_x="$(sed_escape "$(xml_escape "$repo_dir")")"
  [ -r "$template" ] || { echo "plist の雛形が読めない: $template" >&2; return 1; }

  # クローン先（雛形では /Users/zukky/apps/ipo-radar）→ 残りのホーム（/Users/zukky）の順に置き換える。
  # クローン先の中に /Users/zukky が含まれていても巻き込まないよう、いったん目印に置いてから戻す。
  sed -e "s|/Users/zukky/apps/ipo-radar|@@IPO_RADAR_REPO_DIR@@|g" \
      -e "s|/Users/zukky|${home_x}|g" \
      -e "s|@@IPO_RADAR_REPO_DIR@@|${repo_x}|g" "$template" >"$out"

  if [ "$publish" = "1" ]; then
    sed -e 's|<!-- <key>AUTO_PUBLISH</key><string>1</string> -->|<key>AUTO_PUBLISH</key><string>1</string>|' "$out" >"$out.tmp"
    mv "$out.tmp" "$out"
    grep -q '^[[:space:]]*<key>AUTO_PUBLISH</key><string>1</string>' "$out" \
      || { echo "AUTO_PUBLISH を有効にできなかった（雛形のコメント行が変わった？）: $template" >&2; return 1; }
  else
    if grep -q '^[[:space:]]*<key>AUTO_PUBLISH</key>' "$out"; then
      echo "雛形で AUTO_PUBLISH が最初から有効になっている（安全側の既定に反する）: $template" >&2
      return 1
    fi
  fi

  if [ "$repo_dir" != "$DEFAULT_REPO_DIR" ]; then
    # EnvironmentVariables の <dict> の直後に IPO_RADAR_REPO_DIR を足す（nightly-data.sh の REPO_DIR に渡る）
    awk -v line="    <key>IPO_RADAR_REPO_DIR</key><string>$(xml_escape "$repo_dir")</string>" '
      { print }
      /<key>EnvironmentVariables<\/key>/ { want = 1; next }
      want && /<dict>/ { print line; want = 0 }
    ' "$out" >"$out.tmp"
    mv "$out.tmp" "$out"
  fi
  plutil -lint "$out" >/dev/null
}

plist_has_auto_publish() {
  [ -f "$1" ] && grep -q '^[[:space:]]*<key>AUTO_PUBLISH</key><string>1</string>' "$1"
}

# ---------------------------------------------------------------------------
# 点検
# ---------------------------------------------------------------------------
required_node_major() {
  local f="$REPO_DIR/.node-version" v=""
  if [ -r "$f" ]; then
    v="$(sed -E -n '1s/^[[:space:]]*v?([0-9]+).*/\1/p' "$f")"
  fi
  printf '%s' "${v:-$DEFAULT_NODE_MAJOR}"
}

check_env() {
  section "環境"
  if [ "$(uname -s)" = "Darwin" ]; then
    ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '?')（$(uname -m)）/ host=$(hostname) / user=$(id -un)"
  else
    ng "macOS ではない（$(uname -s)）。launchd を使うので macOS 専用"
  fi
}

check_tools() {
  section "道具（node / npm / git）"
  local need node_path node_ver major npm_ver
  need="$(required_node_major)"
  node_path="$(command -v node 2>/dev/null || true)"
  if [ -z "$node_path" ]; then
    ng "node が見つからない（.node-version は ${need}）"
    hint "${HOME}/.local/bin に Node ${need} を置く: https://nodejs.org/en/download から macOS arm64 の tar.gz を展開して bin/ 内を入れる"
  else
    node_ver="$("$node_path" -v 2>/dev/null || true)"
    major="${node_ver#v}"
    major="${major%%.*}"
    case "$major" in
      '' | *[!0-9]*) ng "node のバージョンを読めない（'${node_ver}'）: $node_path" ;;
      *)
        if [ "$major" -eq "$need" ]; then
          ok "node ${node_ver}（${node_path}）: .node-version の ${need} 系に一致"
        elif [ "$major" -gt "$need" ]; then
          warn "node ${node_ver}（${node_path}）は .node-version の ${need} 系より新しい（未検証。動かなければ ${need} 系を入れる）"
        else
          ng "node ${node_ver}（${node_path}）は .node-version の ${need} 系より古い"
          hint "${HOME}/.local/bin に Node ${need} 系を入れ直す（PATH の先頭が ${HOME}/.local/bin になっていること）"
        fi
        ;;
    esac
    if ! PATH="$JOB_PATH" command -v node >/dev/null 2>&1; then
      warn "launchd のジョブが使う PATH（${JOB_PATH}）では node が見つからない。~/.local/bin に置くこと"
    fi
  fi

  if command -v npm >/dev/null 2>&1; then
    npm_ver="$(npm -v 2>/dev/null || echo '?')"
    ok "npm ${npm_ver}"
  else
    ng "npm が見つからない（node と同じ場所に入っているはず）"
  fi

  if git --version >/dev/null 2>&1; then
    ok "$(git --version)"
  else
    ng "git が使えない"
    hint "Command Line Tools が無い可能性: M1 本体の画面で xcode-select --install を実行して承認する"
  fi
}

check_repo() {
  section "クローン（${REPO_DIR}）"
  REPO_STATE="absent"
  REPO_DATA_DIFF=0
  if [ ! -e "$REPO_DIR" ]; then
    warn "まだ無い（導入時に git clone する）"
    return 0
  fi
  if [ ! -d "$REPO_DIR/.git" ]; then
    local entries
    entries="$(ls -A "$REPO_DIR" 2>/dev/null || true)"
    if [ -z "$entries" ]; then
      REPO_STATE="empty"
      warn "空のフォルダがある（導入時にここへ git clone する）"
    elif [ "$entries" = ".m1-state" ] && [ -d "$REPO_DIR/.m1-state" ] && [ ! -L "$REPO_DIR/.m1-state" ]; then
      # クローンが無いままジョブが走ると、状態フォルダ .m1-state だけが残ることがある（旧版のジョブの挙動）。
      # 空フォルダと同じ扱いにして、中身には触れずにここへクローンする。
      REPO_STATE="stateonly"
      warn ".m1-state（ジョブの状態フォルダ）だけが入ったフォルダがある（導入時に中身を残したままここへクローンする）"
    else
      REPO_STATE="notgit"
      ng "git のクローンではないフォルダがある。移すか、IPO_RADAR_REPO_DIR で別の場所を指定する"
    fi
    return 0
  fi

  REPO_STATE="present"
  local branch head origin changed other_changed data_changed untracked n
  branch="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  head="$(git -C "$REPO_DIR" log -1 --format='%h %s' 2>/dev/null || echo '?')"
  if [ "$branch" = "main" ]; then
    ok "クローンあり: branch=main / HEAD=${head}"
  else
    warn "クローンあり: branch=${branch}（main ではない。導入時に main へ切り替える）/ HEAD=${head}"
  fi
  origin="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
  if [ -n "$origin" ] && [ "$origin" != "$REPO_URL" ] && [ "${origin%.git}" != "${REPO_URL%.git}" ]; then
    warn "origin が想定と違う: ${origin}（想定: ${REPO_URL}）"
  fi

  # 未コミットの変更。public/data は夜間ジョブが毎回捨て直す領域なので許容し、それ以外は止める
  changed="$(git -C "$REPO_DIR" diff --name-only HEAD 2>/dev/null || true)"
  other_changed="$(printf '%s\n' "$changed" | grep -v '^public/data/' | grep -v '^$' || true)"
  data_changed="$(printf '%s\n' "$changed" | grep '^public/data/' || true)"
  untracked="$(git -C "$REPO_DIR" ls-files --others --exclude-standard 2>/dev/null || true)"
  if [ -n "$other_changed" ]; then
    n="$(printf '%s\n' "$other_changed" | wc -l | tr -d ' ')"
    ng "作業ツリーに未コミットの変更が ${n} 件ある（専用クローンには手を入れない運用）: $(printf '%s\n' "$other_changed" | head -3 | tr '\n' ' ')"
    hint "内容を確認して、要らなければ git -C ${REPO_DIR} restore . で戻す（消える前に必ず中身を見る）"
  fi
  if [ -n "$data_changed" ]; then
    REPO_DATA_DIFF=1
    n="$(printf '%s\n' "$data_changed" | wc -l | tr -d ' ')"
    warn "public/data に夜間ジョブが残した差分が ${n} 件ある（導入時に git restore で破棄する。ジョブも毎回同じことをする）"
  fi
  if [ -n "$untracked" ]; then
    n="$(printf '%s\n' "$untracked" | wc -l | tr -d ' ')"
    warn "追跡されていないファイルが ${n} 件ある: $(printf '%s\n' "$untracked" | head -3 | tr '\n' ' ')"
  fi
  if [ -z "$other_changed" ] && [ -z "$data_changed" ] && [ -z "$untracked" ]; then
    ok "作業ツリーはきれい"
  fi

  if [ -f "$REPO_DIR/.env" ]; then
    ok ".env あり（EDINET_API_KEY を使う場合のみ必要）"
  else
    warn ".env なし（EDINET の取得だけスキップされる。使うなら EDINET_API_KEY=... を1行書く）"
  fi

  # ジョブの実行痕跡
  local lock started age
  lock="$REPO_DIR/.m1-state/ipo-radar-data.lock"
  if [ -d "$lock" ]; then
    started="$(cat "$lock/started_at" 2>/dev/null || echo 0)"
    case "$started" in '' | *[!0-9]*) started=0 ;; esac
    age=$(( ($(date +%s) - started) / 60 ))
    if [ "$age" -lt "$STALE_LOCK_MIN" ]; then
      ng "夜間ジョブが実行中の可能性（ロック経過 ${age} 分）。終わってからやり直す"
    else
      warn "古いロックが残っている（${age} 分前。次のジョブ起動時に自動で奪って続行する）"
    fi
  fi
  if [ -f "$REPO_DIR/.m1-state/last-success" ]; then
    ok "直近の正常終了: $(cat "$REPO_DIR/.m1-state/last-success")"
  else
    warn "last-success が無い（一度も正常終了していないか、旧版のジョブ）"
  fi
}

http_status() {
  curl -sS -o /dev/null -m 8 -A "$CURL_UA" -w '%{http_code}' "$1" 2>/dev/null </dev/null || true
}

check_network() {
  section "ネットワーク"
  local code
  code="$(http_status https://github.com)"
  case "$code" in
    2?? | 3??) ok "github.com に届く（HTTP ${code}）" ;;
    000 | '') ng "github.com に届かない（ネットワーク・DNS・プロキシを確認）" ;;
    *) warn "github.com が HTTP ${code} を返した" ;;
  esac
  code="$(http_status 'https://query1.finance.yahoo.com/v8/finance/chart/7203.T?range=1d&interval=1d')"
  case "$code" in
    2??) ok "Yahoo Finance（query1.finance.yahoo.com）に届く（HTTP ${code}）" ;;
    000 | '') ng "Yahoo Finance（query1.finance.yahoo.com）に届かない（株価の取得ができない）" ;;
    *) warn "Yahoo Finance が HTTP ${code} を返した（届いてはいる。制限中なら時間をおく）" ;;
  esac
}

check_disk() {
  section "ディスク"
  local avail_kb gb
  avail_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')"
  case "$avail_kb" in '' | *[!0-9]*) warn "空き容量を読めなかった"; return 0 ;; esac
  gb=$((avail_kb / 1024 / 1024))
  if [ "$gb" -lt 2 ]; then
    ng "空きが ${gb}GB しかない（node_modules に約 1GB 要る）"
  elif [ "$gb" -lt 5 ]; then
    warn "空きが ${gb}GB（足りるがあまり余裕はない）"
  else
    ok "空き ${gb}GB"
  fi
}

# nightly-data.sh の vault_available と同じ判定（Plaud/ だけの残骸フォルダを Vault と取り違えない）
vault_is_real() {
  [ -d "$VAULT_ROOT/Plaud" ] && { [ -d "$VAULT_ROOT/.stfolder" ] || [ -d "$VAULT_ROOT/.obsidian" ]; }
}

check_vault() {
  section "失敗の通知先"
  if vault_is_real; then
    ok "Vault あり → 失敗は ${VAULT_ROOT}/Plaud/_エラーログ.md に追記される"
  elif [ -d "$VAULT_ROOT/Plaud" ]; then
    warn "${VAULT_ROOT}/Plaud はあるが Vault の目印（.stfolder / .obsidian）が無い＝残骸。Vault へは書かず、macOS の通知とログで知らせる"
  else
    warn "Vault が無い（${VAULT_ROOT}/Plaud）→ 失敗は macOS の通知とログで知らせる"
  fi
}

check_launchd() {
  section "launchd"
  if launchctl print "$GUI_DOMAIN" >/dev/null 2>&1; then
    ok "${GUI_DOMAIN} が使える"
  else
    ng "${GUI_DOMAIN} が使えない（このユーザーが GUI にログインしていない。M1 の画面でログインしたままにする）"
  fi
  if [ -f "$DEST_PLIST" ]; then
    if plist_has_auto_publish "$DEST_PLIST"; then
      ok "導入済みの plist あり（AUTO_PUBLISH=1 有効）: ${DEST_PLIST}"
    else
      ok "導入済みの plist あり（AUTO_PUBLISH は無効＝ログに出して終了する安全側）: ${DEST_PLIST}"
    fi
  else
    warn "plist はまだ導入されていない"
  fi
  if job_loaded; then
    if job_running; then
      ng "ジョブが今実行中。終わってから再実行する（途中で再登録すると止めてしまう）"
    else
      ok "launchd に登録済み（実行中ではない）"
    fi
  else
    warn "launchd には未登録"
  fi
  if [ -f "$REPO_DIR/$PLIST_TEMPLATE_REL" ]; then
    ok "plist の雛形あり（${PLIST_TEMPLATE_REL}）"
  elif [ "$REPO_STATE" = "present" ]; then
    ng "クローンに plist の雛形が無い（${PLIST_TEMPLATE_REL}）。この変更を main にマージしたか確認する"
  fi
}

git_config_value() {
  if [ "$REPO_STATE" = "present" ]; then
    git -C "$REPO_DIR" config --get "$1" 2>/dev/null || true
  else
    git config --get "$1" 2>/dev/null || true
  fi
}

check_publish() {
  section "自動 push・PR 作成に必要なもの（--publish）"
  local arch gh_arch slug perm name email
  arch="$(uname -m)"
  case "$arch" in arm64) gh_arch="arm64" ;; *) gh_arch="amd64" ;; esac

  if command -v gh >/dev/null 2>&1; then
    ok "$(gh --version 2>/dev/null | head -1)（$(command -v gh)）"
    if gh auth status >/dev/null 2>&1 </dev/null; then
      ok "gh は認証済み"
      slug="${REPO_URL#https://github.com/}"
      slug="${slug%.git}"
      perm="$(gh repo view "$slug" --json viewerPermission --jq .viewerPermission 2>/dev/null </dev/null || true)"
      case "$perm" in
        ADMIN | MAINTAIN | WRITE) ok "${slug} への push 権限あり（${perm}）" ;;
        '') warn "${slug} への権限を確認できなかった（ネットワークか権限）" ;;
        *) ng "${slug} への push 権限が無い（${perm}）。書き込み権限のあるアカウントでログインし直す" ;;
      esac
    else
      ng "gh が未認証"
      hint "M1 本体（または ssh の対話端末）で: gh auth login -h github.com -p https -w   （表示されるコードをブラウザで承認）"
      hint "トークンをチャットやスクリプトに書かない。認証後にもう一度 --check する"
    fi
  else
    ng "gh が無い（~/.local/bin にも無い）"
    hint "Homebrew なしなので公式リリースから ~/.local/bin に入れる（自動ダウンロードはしないので、次を手で実行）:"
    hint "1) https://github.com/cli/cli/releases/latest で最新版を確認（例: v2.xx.x なら VER=2.xx.x）"
    hint "2) VER=2.xx.x; d=\"\$(mktemp -d)\" && cd \"\$d\" && curl -fsSLO \"https://github.com/cli/cli/releases/download/v\${VER}/gh_\${VER}_macOS_${gh_arch}.zip\" \\"
    hint "     && unzip -q \"gh_\${VER}_macOS_${gh_arch}.zip\" && mkdir -p ~/.local/bin && cp \"gh_\${VER}_macOS_${gh_arch}/bin/gh\" ~/.local/bin/ && ~/.local/bin/gh --version"
    hint "3) gh auth login -h github.com -p https -w"
  fi

  name="$(git_config_value user.name)"
  email="$(git_config_value user.email)"
  if [ -n "$name" ]; then ok "git user.name = ${name}"; else ng "git の user.name が未設定"; fi
  if [ -n "$email" ]; then ok "git user.email = ${email}"; else ng "git の user.email が未設定"; fi
  if [ -z "$name" ] || [ -z "$email" ]; then
    hint "git config --global user.name  \"Kazuki Yoshida\""
    hint "git config --global user.email \"GitHub に登録したメールアドレス\"   （コミットの作者名に使う）"
  fi
}

run_checks() {
  say "== IPO Radar 夜間ジョブ 点検 =="
  say "クローン先: ${REPO_DIR}"
  say "plist: ${DEST_PLIST}"
  if [ "$PUBLISH" = "1" ]; then say "モード: --publish（push と PR 作成まで自動。マージは人間）"; fi
  check_env
  check_tools
  check_repo
  check_network
  check_disk
  check_vault
  check_launchd
  if [ "$PUBLISH" = "1" ]; then check_publish; fi
  printf '\n結果: ✅ %s / ⚠️  %s / ❌ %s\n' "$N_OK" "$N_WARN" "$N_NG"
}

# ---------------------------------------------------------------------------
# 導入
# ---------------------------------------------------------------------------
node_major_now() {
  local v
  v="$(node -v 2>/dev/null || true)"
  v="${v#v}"
  printf '%s' "${v%%.*}"
}

step_repo() {
  say "→ クローンを最新の main にする"
  case "$REPO_STATE" in
    absent | empty)
      mkdir -p "$(dirname "$REPO_DIR")"
      git clone "$REPO_URL" "$REPO_DIR" </dev/null
      ;;
    stateonly)
      # git clone は空でないフォルダには入れない。.m1-state を消したり動かしたりせず、クローン先を
      # 途中の状態にもしないため、隣に一時フォルダを作ってそこへ clone（作業ツリー無し）し、成功したら
      # .git だけを所定の場所へ移して作業ツリーを展開する。clone に失敗しても REPO_DIR には何も起きない。
      local tmp_clone
      tmp_clone="$(mktemp -d "${REPO_DIR%/}.clone.XXXXXX")"
      if ! git clone --no-checkout "$REPO_URL" "$tmp_clone/repo" </dev/null; then
        rmdir "$tmp_clone" 2>/dev/null || true
        die "git clone に失敗した（${REPO_URL}）。ネットワークを確認してやり直す（${REPO_DIR} には手を付けていない）"
      fi
      mv "$tmp_clone/repo/.git" "$REPO_DIR/.git"
      rmdir "$tmp_clone/repo" "$tmp_clone"
      git -C "$REPO_DIR" checkout -q -f main </dev/null
      ;;
    present)
      if [ "$REPO_DATA_DIFF" = "1" ]; then
        say "  public/data の残り差分を破棄する（夜間ジョブが毎回やることと同じ）"
        git -C "$REPO_DIR" restore --worktree --staged -- public/data
      fi
      git -C "$REPO_DIR" fetch origin main </dev/null
      git -C "$REPO_DIR" checkout main </dev/null
      git -C "$REPO_DIR" pull --ff-only origin main </dev/null
      ;;
    *) die "クローンの状態が不明（${REPO_STATE}）" ;;
  esac
  say "  HEAD: $(git -C "$REPO_DIR" log -1 --format='%h %s')"

  # クローン後に .node-version が確定するので、もう一度だけ版を確かめる
  local need major
  need="$(required_node_major)"
  major="$(node_major_now)"
  case "$major" in '' | *[!0-9]*) die "node のバージョンを読めない" ;; esac
  if [ "$major" -lt "$need" ]; then
    die "node ${major} 系は .node-version の ${need} 系より古い。node を入れ直してからやり直す"
  fi
}

step_npm() {
  say "→ 依存パッケージ"
  local lock_hash hash_file stored need_ci
  lock_hash="$(shasum -a 256 "$REPO_DIR/package-lock.json" | awk '{print $1}')"
  mkdir -p "$REPO_DIR/.m1-state"
  hash_file="$REPO_DIR/.m1-state/package-lock.sha256"
  stored=""
  if [ -f "$hash_file" ]; then stored="$(cat "$hash_file")"; fi

  need_ci=0
  if [ ! -d "$REPO_DIR/node_modules" ]; then
    need_ci=1
    say "  node_modules が無い → npm ci"
  elif [ -n "$stored" ] && [ "$stored" != "$lock_hash" ]; then
    need_ci=1
    say "  package-lock.json が前回の npm ci から変わっている → npm ci"
  elif [ -z "$stored" ] && ! (cd "$REPO_DIR" && npm ls --all >/dev/null 2>&1); then
    need_ci=1
    say "  node_modules が package-lock.json と合っていない → npm ci"
  fi

  if [ "$need_ci" = "1" ]; then
    if ! (cd "$REPO_DIR" && npm ci </dev/null); then die "npm ci に失敗した"; fi
  else
    say "  変更なし → npm ci はスキップ"
  fi
  printf '%s\n' "$lock_hash" >"$hash_file"
}

step_plist() {
  say "→ plist を作る"
  local template generated backup
  template="$REPO_DIR/$PLIST_TEMPLATE_REL"
  generated="$REPO_DIR/.m1-state/${LABEL}.plist.generated"
  mkdir -p "$REPO_DIR/.m1-state" "$LAUNCH_AGENTS_DIR" "$(dirname "$LOG_FILE")"
  render_plist "$template" "$generated" "$PUBLISH" "$REPO_DIR" || die "plist の生成に失敗した"
  say "  雛形 ${PLIST_TEMPLATE_REL} から生成し、plutil -lint も通った"

  if [ -f "$DEST_PLIST" ] && cmp -s "$generated" "$DEST_PLIST"; then
    PLIST_CHANGED=0
    say "  導入済みの plist と同じ内容 → 差し替えない"
    return 0
  fi

  if [ -f "$DEST_PLIST" ]; then
    if plist_has_auto_publish "$DEST_PLIST" && ! plist_has_auto_publish "$generated"; then
      warn "導入済みは AUTO_PUBLISH=1 だが、今回は --publish が無いので無効で入れ替える（維持したいなら --publish を付けて再実行）"
    elif ! plist_has_auto_publish "$DEST_PLIST" && plist_has_auto_publish "$generated"; then
      say "  AUTO_PUBLISH を 無効 → 有効 に切り替える"
    fi
    backup="${DEST_PLIST}.bak-$(stamp)"
    if [ -e "$backup" ]; then backup="${backup}-$$"; fi
    mv "$DEST_PLIST" "$backup"
    say "  既存の plist を退避: ${backup}"
  fi
  cp "$generated" "$DEST_PLIST"
  plutil -lint "$DEST_PLIST" >/dev/null || die "導入した plist が壊れている: $DEST_PLIST"
  say "  導入: ${DEST_PLIST}"
}

step_launchd() {
  say "→ launchd に登録"
  if [ "$PLIST_CHANGED" = "0" ] && job_loaded; then
    say "  plist に変更なしで登録済み → 再登録は不要"
  else
    if job_loaded; then
      if job_running; then die "ジョブが実行中なので再登録できない（止めてしまう）。終わってからやり直す"; fi
      launchctl bootout "$GUI_DOMAIN/$LABEL"
      say "  bootout 済み"
    fi
    # bootout 直後は登録が残っていて失敗することがあるので、数回だけ待ってやり直す
    local try=1
    while :; do
      if launchctl bootstrap "$GUI_DOMAIN" "$DEST_PLIST" 2>/dev/null; then break; fi
      if [ "$try" -ge 3 ]; then
        launchctl bootstrap "$GUI_DOMAIN" "$DEST_PLIST" \
          || die "launchctl bootstrap に失敗した（launchctl enable ${GUI_DOMAIN}/${LABEL} が要ることもある）"
        break
      fi
      try=$((try + 1))
      sleep 1
    done
    say "  bootstrap 済み"
  fi
  print_job_summary
}

print_job_summary() {
  local out state runs last hour minute pub ptype
  out="$(job_print)"
  if [ -z "$out" ]; then warn "launchctl print で状態を読めなかった"; return 0; fi
  state="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*state = //p' | head -1 || true)"
  runs="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*runs = //p' | head -1 || true)"
  last="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*last exit code = //p' | head -1 || true)"
  hour="$(printf '%s\n' "$out" | sed -n 's/.*"Hour" => \([0-9]*\).*/\1/p' | head -1 || true)"
  minute="$(printf '%s\n' "$out" | sed -n 's/.*"Minute" => \([0-9]*\).*/\1/p' | head -1 || true)"
  pub="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*AUTO_PUBLISH => //p' | head -1 || true)"
  ptype="$(plutil -extract ProcessType raw -o - "$DEST_PLIST" 2>/dev/null || echo '未指定')"
  say "  状態: ${state:-?} / 実行回数: ${runs:-?} / 前回の終了コード: ${last:-?}"
  if [ -n "$hour" ]; then
    say "  次回: 毎日 $(printf '%02d:%02d' "$hour" "${minute:-0}") に起動（StartCalendarInterval）"
  else
    warn "起動スケジュールを読めなかった"
  fi
  say "  AUTO_PUBLISH: ${pub:-無効（安全側: push・PR は作らない）} / ProcessType: ${ptype}"
}

step_run_now() {
  say "→ 1回実行する（launchctl kickstart）"
  if [ "$PUBLISH" = "1" ]; then
    say "  ※ --publish なので、差分があれば本当にブランチを push して PR を作る（マージはしない）"
  fi
  local before waited=0 tail_from
  before=0
  if [ -f "$LOG_FILE" ]; then before="$(wc -l <"$LOG_FILE" | tr -d ' ')"; fi
  launchctl kickstart "$GUI_DOMAIN/$LABEL"
  sleep 3
  while job_running; do
    if [ "$waited" -ge "$RUN_NOW_TIMEOUT_SEC" ]; then
      warn "${RUN_NOW_TIMEOUT_SEC} 秒待っても終わらない。ジョブは動いたまま（ログ: ${LOG_FILE}）"
      break
    fi
    sleep 10
    waited=$((waited + 10))
    if [ $((waited % 60)) -eq 0 ]; then say "  実行中…（${waited} 秒）"; fi
  done
  print_job_summary
  say "  --- ログ末尾（今回分, ${LOG_FILE}）---"
  tail_from=$((before + 1))
  if [ -f "$LOG_FILE" ]; then
    tail -n "+${tail_from}" "$LOG_FILE" | tail -n 40
  fi
  if [ -f "$REPO_DIR/.m1-state/last-success" ]; then
    say "  last-success: $(cat "$REPO_DIR/.m1-state/last-success")"
  fi
}

do_install() {
  section "導入"
  step_repo
  step_npm
  step_plist
  step_launchd
  if [ "$RUN_NOW" = "1" ]; then step_run_now; fi
  printf '\n✅ 導入完了（%s）。ログ: %s\n' "$LABEL" "$LOG_FILE"
  if [ "$PUBLISH" != "1" ]; then
    say "   AUTO_PUBLISH は無効のまま（差分サマリをログに出して終了）。push・PR まで自動にするなら --publish を付けて再実行。"
  fi
}

# ---------------------------------------------------------------------------
# 取り外し（削除はせず retired/ へ移す）
# ---------------------------------------------------------------------------
do_uninstall() {
  say "== IPO Radar 夜間ジョブ 取り外し =="
  say "対象: ${DEST_PLIST}"
  if job_loaded; then
    if job_running; then die "ジョブが今実行中。終わってからやり直す（途中で止めない）"; fi
    launchctl bootout "$GUI_DOMAIN/$LABEL"
    say "✅ launchd から外した（bootout）"
  else
    say "・launchd には登録されていない"
  fi
  if [ -f "$DEST_PLIST" ]; then
    local dest
    mkdir -p "$RETIRED_DIR"
    dest="$RETIRED_DIR/${LABEL}.$(stamp).plist"
    if [ -e "$dest" ]; then dest="${RETIRED_DIR}/${LABEL}.$(stamp)-$$.plist"; fi
    mv "$DEST_PLIST" "$dest"
    say "✅ plist を移した: ${dest}"
  else
    say "・導入済みの plist は無い"
  fi
  say "クローン（${REPO_DIR}）とログは残してある。もう使わないなら手で片付ける。"
}

# ---------------------------------------------------------------------------
main() {
  parse_args "$@"
  if [ "$UNINSTALL" = "1" ]; then
    do_uninstall
    return 0
  fi
  run_checks
  if [ "$CHECK_ONLY" = "1" ]; then
    if [ "$N_NG" -gt 0 ]; then return 1; fi
    return 0
  fi
  if [ "$N_NG" -gt 0 ]; then
    say ""
    say "❌ が ${N_NG} 件あるので導入には進みません。上の ❌ を直してからもう一度実行してください。"
    return 1
  fi
  do_install
}

# 直接実行・標準入力（bash -s）のときだけ動かす。source されたとき（検証用）は関数を読み込むだけ。
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
