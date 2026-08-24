#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
upgrader="$root/scripts/upgrade-linux.sh"

bash -n "$upgrader"
grep -q 'sha256sum --check --status' "$upgrader" || { echo 'archive checksum verification missing' >&2; exit 1; }
grep -q 'restoring the previous release' "$upgrader" || { echo 'health-check rollback missing' >&2; exit 1; }
grep -q 'DATA_DIR="${EH_DATA_DIR:-/var/lib/educationhelper}"' "$upgrader" || { echo 'persistent data boundary missing' >&2; exit 1; }
grep -q 'No complete installation found; starting a clean deployment' "$upgrader" || { echo 'clean-deployment fallback missing' >&2; exit 1; }
grep -q 'deploy-linux.sh' "$upgrader" || { echo 'deployment bootstrap URL missing' >&2; exit 1; }

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo 'upgrade-linux static checks passed (integration cases require Linux symlinks)'
    exit 0
    ;;
esac

fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
app_base="$fixture/opt/educationhelper"
data_dir="$fixture/var/lib/educationhelper"
config_dir="$fixture/etc/educationhelper"
old_release="$app_base/releases/1.5.0"
source_root="$fixture/source/EducationHelper-1.5.1"
archive="$fixture/EducationHelper-1.5.1-linux-source.tar.gz"
manifest="$fixture/latest-linux.json"

mkdir -p "$old_release" "$data_dir" "$config_dir" "$source_root/web/dist"
touch "$source_root/pixi.toml" "$source_root/web/package.json" "$source_root/web/dist/index.html"
printf 'keep-me\n' >"$data_dir/preserved.txt"
ln -s "$old_release" "$app_base/current"
tar -czf "$archive" -C "$fixture/source" "EducationHelper-1.5.1"
sha="$(sha256sum "$archive" | awk '{print $1}')"
cat >"$manifest" <<EOF
{"version":"1.5.1","archive_url":"https://example.invalid/release.tar.gz","archive_sha256":"$sha"}
EOF

common_env=(
  "EH_TEST_MODE=1"
  "EH_SKIP_BUILD=1"
  "EH_APP_BASE=$app_base"
  "EH_DATA_DIR=$data_dir"
  "EH_CONFIG_DIR=$config_dir"
  "EH_SERVICE_USER=$(id -un)"
  "EH_MANIFEST_FILE=$manifest"
  "EH_ARCHIVE_FILE=$archive"
)

env "${common_env[@]}" EH_HEALTHCHECK_COMMAND=true bash "$upgrader"
[[ "$(readlink -f "$app_base/current")" == "$(readlink -f "$app_base/releases/1.5.1")" ]] \
  || { echo 'successful upgrade did not switch current release' >&2; exit 1; }
[[ "$(cat "$data_dir/preserved.txt")" == "keep-me" ]] \
  || { echo 'upgrade modified persistent data' >&2; exit 1; }

ln -sfn "$old_release" "$app_base/current"
bad_manifest="$fixture/bad-checksum.json"
cat >"$bad_manifest" <<EOF
{"version":"1.5.1","archive_url":"https://example.invalid/release.tar.gz","archive_sha256":"$(printf '0%.0s' {1..64})"}
EOF
if env "${common_env[@]}" EH_MANIFEST_FILE="$bad_manifest" EH_HEALTHCHECK_COMMAND=true bash "$upgrader"; then
  echo 'checksum mismatch was accepted' >&2
  exit 1
fi
[[ "$(readlink -f "$app_base/current")" == "$(readlink -f "$old_release")" ]] \
  || { echo 'checksum failure changed current release' >&2; exit 1; }

rm -rf -- "$app_base/releases/1.5.1"
if env "${common_env[@]}" EH_HEALTHCHECK_COMMAND=false bash "$upgrader"; then
  echo 'failed health check was accepted' >&2
  exit 1
fi
[[ "$(readlink -f "$app_base/current")" == "$(readlink -f "$old_release")" ]] \
  || { echo 'health failure did not roll back current release' >&2; exit 1; }

echo 'upgrade-linux integration checks passed'
