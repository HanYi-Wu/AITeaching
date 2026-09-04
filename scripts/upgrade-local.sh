#!/usr/bin/env bash
# Distributed as update.sh beside the verified source archive and upgrade engine.
set -Eeuo pipefail
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for filename in release.json educationhelper-source.tar.gz upgrade-linux.sh; do
  [[ -f "$package_dir/$filename" ]] || { printf 'Missing package file: %s\n' "$filename" >&2; exit 1; }
done
printf '[EducationHelper] Upgrading from local package (no source download)\n'
EH_MANIFEST_FILE="$package_dir/release.json" \
EH_ARCHIVE_FILE="$package_dir/educationhelper-source.tar.gz" \
  bash "$package_dir/upgrade-linux.sh"
