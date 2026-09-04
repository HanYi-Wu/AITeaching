#!/usr/bin/env bash
# Upgrade an existing EH installation when Sites downloads are unavailable.
set -Eeuo pipefail
release_base='https://raw.githubusercontent.com/HanYi-Wu/AITeaching/master/product-site/public/releases'
[[ -L "${EH_APP_BASE:-/opt/educationhelper}/current" ]] || {
  echo '[EducationHelper] This fallback upgrades an existing installation only.' >&2
  exit 1
}
download_env=(env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy)
if [[ -n "${EH_INSTALL_PROXY_URL:-}" ]]; then
  [[ "$EH_INSTALL_PROXY_URL" =~ ^https?://[A-Za-z0-9._:-]+$ ]] || { echo 'Invalid installation proxy' >&2; exit 1; }
  download_env+=("https_proxy=$EH_INSTALL_PROXY_URL" "http_proxy=$EH_INSTALL_PROXY_URL")
fi
fetch() {
  if command -v wget >/dev/null 2>&1; then
    "${download_env[@]}" wget --timeout=30 --tries=2 -O "$2" "$1"
  elif command -v curl >/dev/null 2>&1; then
    "${download_env[@]}" curl -fL --connect-timeout 30 --retry 2 -o "$2" "$1"
  else
    echo 'Install wget or native curl first.' >&2; return 1
  fi
}
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
echo '[EducationHelper] Downloading latest release metadata and upgrader from GitHub'
fetch "$release_base/latest-linux.json" "$work_dir/latest-linux.json"
fetch "$release_base/upgrade-linux.sh" "$work_dir/upgrade-linux.sh"
# Only switch the archive mirror; keep the original SHA-256 verification intact.
sed -i "s|https://educationhelper-downloads.btxmnr988y.chatgpt.site/releases|$release_base|g" "$work_dir/latest-linux.json"
EH_MANIFEST_FILE="$work_dir/latest-linux.json" bash "$work_dir/upgrade-linux.sh"
