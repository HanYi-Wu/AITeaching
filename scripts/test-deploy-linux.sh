#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
installer="$root/scripts/deploy-linux.sh"

bash -n "$installer"
grep -q '^fetch_to()' "$installer" || { echo 'missing fetch_to downloader abstraction' >&2; exit 1; }
grep -q 'command -v curl' "$installer" || { echo 'curl fallback missing' >&2; exit 1; }
grep -q 'command -v wget' "$installer" || { echo 'wget fallback missing' >&2; exit 1; }
grep -q 'command -v python3' "$installer" || { echo 'python3 fallback missing' >&2; exit 1; }
wget_line="$(grep -n 'command -v wget' "$installer" | head -n 1 | cut -d: -f1)"
curl_line="$(grep -n 'command -v curl' "$installer" | head -n 1 | cut -d: -f1)"
if (( wget_line >= curl_line )); then
  echo 'wget must be preferred over sandboxed curl implementations' >&2
  exit 1
fi
if grep -q 'command -v curl.*fail "curl is required"' "$installer"; then
  echo 'installer still hard-requires curl' >&2
  exit 1
fi
grep -q 'PIXI_MIN_VERSION="0.75.0"' "$installer" || {
  echo 'installer does not require a lock-v7-compatible Pixi version' >&2
  exit 1
}
grep -q '^version_ge()' "$installer" || { echo 'Pixi version compatibility check missing' >&2; exit 1; }
if grep -q 'v0\.62\.2' "$installer"; then
  echo 'obsolete Pixi pin remains' >&2
  exit 1
fi
eval "$(sed -n '/^version_ge()/,/^}/p' "$installer")"
version_ge 0.75.0 0.75.0 || { echo 'equal Pixi version rejected' >&2; exit 1; }
version_ge 0.76.0 0.75.0 || { echo 'newer Pixi version rejected' >&2; exit 1; }
if version_ge 0.62.2 0.75.0; then
  echo 'obsolete Pixi version accepted' >&2
  exit 1
fi

echo 'deploy-linux downloader regression checks passed'
