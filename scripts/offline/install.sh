#!/usr/bin/env bash
set -Eeuo pipefail
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo '需要系统 Python 3.10+，不会自动联网安装。' >&2; exit 1; }
if (( EUID != 0 )); then
  exec sudo -- python3 "$package_dir/installer.py" --package "$package_dir" "$@"
fi
exec python3 "$package_dir/installer.py" --package "$package_dir" "$@"
