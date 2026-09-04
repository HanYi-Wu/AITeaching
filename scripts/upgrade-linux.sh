#!/usr/bin/env bash
# Upgrade an existing EducationHelper systemd installation to the latest release.
# Public options: EH_INSTALL_PROXY_URL, EH_RUNTIME_PROXY_URL, EH_PORT, EH_SERVICE_USER.

set -Eeuo pipefail

RELEASE_BASE_URL="https://educationhelper-downloads.btxmnr988y.chatgpt.site/releases"
MANIFEST_URL="${EH_MANIFEST_URL:-$RELEASE_BASE_URL/latest-linux.json}"
APP_BASE="${EH_APP_BASE:-/opt/educationhelper}"
CURRENT_LINK="$APP_BASE/current"
DATA_DIR="${EH_DATA_DIR:-/var/lib/educationhelper}"
CONFIG_DIR="${EH_CONFIG_DIR:-/etc/educationhelper}"
WEB_PORT="${EH_PORT:-5173}"
INSTALL_PROXY_URL="${EH_INSTALL_PROXY_URL:-}"
RUNTIME_PROXY_URL="${EH_RUNTIME_PROXY_URL:-}"
TEST_MODE="${EH_TEST_MODE:-0}"
SKIP_BUILD="${EH_SKIP_BUILD:-0}"

log() { printf '[EducationHelper] %s\n' "$*"; }
fail() { printf '[EducationHelper] ERROR: %s\n' "$*" >&2; exit 1; }

fetch_to() {
  local destination="$1"
  local url="$2"
  if command -v wget >/dev/null 2>&1; then
    "${download_env[@]}" wget --quiet --tries=3 --timeout=20 --output-document="$destination" "$url"
  elif command -v curl >/dev/null 2>&1; then
    "${download_env[@]}" curl --fail --location --retry 3 --connect-timeout 20 --output "$destination" "$url"
  elif command -v python3 >/dev/null 2>&1; then
    "${download_env[@]}" python3 - "$url" "$destination" <<'PY'
import sys
import urllib.request

url, destination = sys.argv[1:]
with urllib.request.urlopen(url, timeout=30) as response, open(destination, "wb") as output:
    output.write(response.read())
PY
  else
    fail "wget, curl, or python3 is required to download release files"
  fi
}

[[ "$WEB_PORT" =~ ^[0-9]+$ ]] && (( WEB_PORT >= 1024 && WEB_PORT <= 65535 )) \
  || fail "EH_PORT must be an unprivileged TCP port between 1024 and 65535"
for proxy_value in "$INSTALL_PROXY_URL" "$RUNTIME_PROXY_URL"; do
  if [[ -n "$proxy_value" && ! "$proxy_value" =~ ^https?://[A-Za-z0-9._:-]+$ ]]; then
    fail "Proxy URLs must look like http://host:port"
  fi
done

download_env=()
if [[ -n "$INSTALL_PROXY_URL" ]]; then
  download_env=(env "HTTP_PROXY=$INSTALL_PROXY_URL" "HTTPS_PROXY=$INSTALL_PROXY_URL" "http_proxy=$INSTALL_PROXY_URL" "https_proxy=$INSTALL_PROXY_URL")
fi

if [[ ! -L "$CURRENT_LINK" ]]; then
  log "No complete installation found; starting a clean deployment"
  bootstrap_script="$(mktemp)"
  trap 'rm -f -- "$bootstrap_script"' EXIT
  fetch_to "$bootstrap_script" "$RELEASE_BASE_URL/deploy-linux.sh"
  chmod 700 "$bootstrap_script"
  EH_INSTALL_PROXY_URL="$INSTALL_PROXY_URL" EH_RUNTIME_PROXY_URL="$RUNTIME_PROXY_URL" \
    EH_PORT="$WEB_PORT" bash "$bootstrap_script"
  log "Initial deployment complete"
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  json_python="python3"
elif command -v python >/dev/null 2>&1; then
  json_python="python"
else
  fail "python3 is required to read release metadata"
fi
command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

old_release="$(readlink -f "$CURRENT_LINK")"
[[ -d "$old_release" ]] || fail "Current release target is missing: $old_release"

sudo_cmd=()
if [[ "$TEST_MODE" != "1" ]]; then
  command -v sudo >/dev/null 2>&1 || fail "sudo is required"
  if (( EUID != 0 )); then
    log "Requesting administrator privileges once"
    sudo -v
  fi
  sudo_cmd=(sudo)
fi

runtime_env_file="$CONFIG_DIR/educationhelper.env"
config_repaired=0
if [[ -f "$runtime_env_file" ]]; then
  "${sudo_cmd[@]}" cp -p "$runtime_env_file" "$runtime_env_file.before-network-migration"
  "${sudo_cmd[@]}" sed -i \
    -e '/^HTTP_PROXY=/d' -e '/^HTTPS_PROXY=/d' -e '/^http_proxy=/d' -e '/^https_proxy=/d' \
    -e '/^ALL_PROXY=/d' -e '/^all_proxy=/d' "$runtime_env_file"
  if [[ -n "$RUNTIME_PROXY_URL" ]]; then
    "${sudo_cmd[@]}" sed -i \
      -e '/^EH_EXTERNAL_PROXY_URL=/d' \
      "$runtime_env_file"
    printf 'EH_EXTERNAL_PROXY_URL=%s\n' "$RUNTIME_PROXY_URL" \
      | "${sudo_cmd[@]}" tee -a "$runtime_env_file" >/dev/null
  fi
  "${sudo_cmd[@]}" sed -i -e '/^NO_PROXY=/d' -e '/^no_proxy=/d' "$runtime_env_file"
  printf 'NO_PROXY=127.0.0.1,localhost,::1\nno_proxy=127.0.0.1,localhost,::1\n' \
    | "${sudo_cmd[@]}" tee -a "$runtime_env_file" >/dev/null
  config_repaired=1
  log "Removed global proxies. Runtime is direct; opt-in hosts use EH_PROXY_HOSTS + EH_EXTERNAL_PROXY_URL."
fi

tmp_dir="$(mktemp -d)"
switched=0
cleanup_and_rollback() {
  local status=$?
  set +e
  if (( status != 0 && switched == 1 )); then
    log "Upgrade failed; restoring the previous release"
    "${sudo_cmd[@]}" ln -sfn "$old_release" "$CURRENT_LINK"
    if [[ "$TEST_MODE" != "1" ]]; then
      "${sudo_cmd[@]}" systemctl restart educationhelper-backend.service educationhelper-web.service
    fi
  fi
  rm -rf -- "$tmp_dir"
  exit "$status"
}
trap cleanup_and_rollback EXIT

manifest="$tmp_dir/latest-linux.json"
if [[ -n "${EH_MANIFEST_FILE:-}" ]]; then
  cp -- "$EH_MANIFEST_FILE" "$manifest"
else
  log "Downloading latest release metadata"
  fetch_to "$manifest" "$MANIFEST_URL"
fi

mapfile -t release_meta < <("$json_python" - "$manifest" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    data = json.load(source)
for key in ("version", "archive_url", "archive_sha256"):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"missing release field: {key}")
    print(value.strip())
PY
)
(( ${#release_meta[@]} == 3 )) || fail "Latest release metadata is incomplete"
version="${release_meta[0]}"
archive_url="${release_meta[1]}"
archive_sha256="${release_meta[2]}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Release version is invalid"
[[ "$archive_sha256" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Release checksum is invalid"
if [[ -z "${EH_ARCHIVE_FILE:-}" && ! "$archive_url" =~ ^https:// ]]; then
  fail "Release archive URL must use HTTPS"
fi

new_release="$APP_BASE/releases/$version"
if [[ "$old_release" == "$(readlink -m "$new_release")" ]]; then
  if (( config_repaired == 1 )) && [[ "$TEST_MODE" != "1" ]]; then
    "${sudo_cmd[@]}" systemctl restart educationhelper-backend.service educationhelper-web.service
  fi
  log "EducationHelper $version is already installed"
  switched=0
  exit 0
fi

archive="$tmp_dir/educationhelper.tar.gz"
if [[ -n "${EH_ARCHIVE_FILE:-}" ]]; then
  cp -- "$EH_ARCHIVE_FILE" "$archive"
else
  log "Downloading EducationHelper $version"
  fetch_to "$archive" "$archive_url"
fi
printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum --check --status \
  || fail "Release archive checksum mismatch"

staged="$tmp_dir/release"
mkdir -p "$staged"
tar -xzf "$archive" --strip-components=1 -C "$staged"
[[ -f "$staged/pixi.toml" && -f "$staged/web/package.json" ]] \
  || fail "Release archive is incomplete"

service_user="${EH_SERVICE_USER:-$(stat -c %U "$old_release")}"
id "$service_user" >/dev/null 2>&1 || fail "Service user does not exist: $service_user"
service_home="$(getent passwd "$service_user" | cut -d: -f6)"
[[ -n "$service_home" ]] || fail "Could not determine the service user's home directory"
pixi_bin="$service_home/.pixi/bin/pixi"

"${sudo_cmd[@]}" mkdir -p "$APP_BASE/releases" "$DATA_DIR" "$CONFIG_DIR"
if [[ -e "$new_release" ]]; then
  replaced="$APP_BASE/releases/${version}.replaced.$(date +%Y%m%d%H%M%S)"
  "${sudo_cmd[@]}" mv -- "$new_release" "$replaced"
  log "Preserved the previous copy of $version at $replaced"
fi
"${sudo_cmd[@]}" mv -- "$staged" "$new_release"
if [[ "$TEST_MODE" != "1" ]]; then
  "${sudo_cmd[@]}" chown -R "$service_user:$service_user" "$new_release"
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  [[ -x "$pixi_bin" ]] || fail "Pixi is missing at $pixi_bin; rerun deploy-linux.sh to repair the host"
  runtime_env=(HOME="$service_home" NO_PROXY="127.0.0.1,localhost,::1" no_proxy="127.0.0.1,localhost,::1")
  if [[ -n "$INSTALL_PROXY_URL" ]]; then
    runtime_env+=(HTTP_PROXY="$INSTALL_PROXY_URL" HTTPS_PROXY="$INSTALL_PROXY_URL" http_proxy="$INSTALL_PROXY_URL" https_proxy="$INSTALL_PROXY_URL")
  fi
  run_as=()
  if [[ "$(id -un)" != "$service_user" ]]; then
    run_as=("${sudo_cmd[@]}" -u "$service_user")
  fi
  log "Installing locked dependencies and building the Web interface"
  "${run_as[@]}" env "${runtime_env[@]}" "$pixi_bin" install --manifest-path "$new_release/pixi.toml" --frozen
  "${run_as[@]}" env "${runtime_env[@]}" "$pixi_bin" run --manifest-path "$new_release/pixi.toml" --frozen bootstrap
  "${run_as[@]}" env "${runtime_env[@]}" "$pixi_bin" run --manifest-path "$new_release/pixi.toml" --frozen build
fi
[[ -f "$new_release/web/dist/index.html" ]] || fail "Web build did not produce dist/index.html"

log "Switching to EducationHelper $version"
"${sudo_cmd[@]}" ln -sfn "$new_release" "$CURRENT_LINK"
switched=1
if [[ "$TEST_MODE" != "1" ]]; then
  "${sudo_cmd[@]}" systemctl restart educationhelper-backend.service educationhelper-web.service
fi

health_ok=0
if [[ -n "${EH_HEALTHCHECK_COMMAND:-}" ]]; then
  if bash -c "$EH_HEALTHCHECK_COMMAND"; then health_ok=1; fi
else
  log "Waiting for health checks"
  for _ in $(seq 1 30); do
    if "$json_python" - "$WEB_PORT" <<'PY'
import sys
import urllib.request

port = sys.argv[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    for url in ("http://127.0.0.1:8000/api/health", f"http://127.0.0.1:{port}/"):
        with opener.open(url, timeout=3) as response:
            if response.status >= 400:
                raise SystemExit(1)
except Exception:
    raise SystemExit(1)
PY
    then
      health_ok=1
      break
    fi
    sleep 1
  done
fi
(( health_ok == 1 )) || fail "Health check failed after upgrade"

switched=0
log "Upgrade complete: $version"
log "Persistent data remains in $DATA_DIR and configuration remains in $CONFIG_DIR"
