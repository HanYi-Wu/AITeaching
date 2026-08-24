#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
installer="$root/scripts/deploy-linux.sh"

bash -n "$installer"
grep -q '^fetch_to()' "$installer" || { echo 'missing fetch_to downloader abstraction' >&2; exit 1; }
grep -q 'command -v curl' "$installer" || { echo 'curl fallback missing' >&2; exit 1; }
grep -q 'command -v wget' "$installer" || { echo 'wget fallback missing' >&2; exit 1; }
grep -q 'command -v python3' "$installer" || { echo 'python3 fallback missing' >&2; exit 1; }
if grep -q 'command -v curl.*fail "curl is required"' "$installer"; then
  echo 'installer still hard-requires curl' >&2
  exit 1
fi

echo 'deploy-linux downloader regression checks passed'
