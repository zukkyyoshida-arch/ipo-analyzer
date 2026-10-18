#!/usr/bin/env bash
# カブレーダーの Android アプリ（TWA）を Bubblewrap でビルドする。
# 前提: ~/.bubblewrap/config.json に jdkPath / androidSdkPath、.env に TWA_KEYSTORE_PASSWORD / TWA_KEY_PASSWORD、
#       android-twa/android.keystore（git 管理外）。初回は README「Android アプリ（TWA）」を参照。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
export JAVA_HOME="${JAVA_HOME:-$HOME/.bubblewrap/jdk/Contents/Home}"
export BUBBLEWRAP_KEYSTORE_PASSWORD="$TWA_KEYSTORE_PASSWORD" BUBBLEWRAP_KEY_PASSWORD="$TWA_KEY_PASSWORD"
cd "$ROOT/android-twa"
# twa-manifest.json を変えたら update で Android プロジェクトへ反映してからビルドする
npx --yes @bubblewrap/cli update --skipVersionUpgrade
npx --yes @bubblewrap/cli build --skipPwaValidation
ls -la app-release-signed.apk app-release-bundle.aab 2>/dev/null || true
