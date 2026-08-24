#!/usr/bin/env bash
# EducationHelper 1.5.0 production-style LAN deployment for systemd Linux hosts.
# Optional environment variables:
#   EH_PORT=5173
#   EH_INSTALL_PROXY_URL=http://proxy-host:7890  (installation only)
#   EH_RUNTIME_PROXY_URL=http://proxy-host:7890  (optional AI runtime proxy)
#   EH_SERVICE_USER=<existing non-root user>  (required only when invoked as root)

set -Eeuo pipefail

VERSION="1.5.0"
PIXI_MIN_VERSION="0.75.0"
ARCHIVE_URL="https://educationhelper-downloads.btxmnr988y.chatgpt.site/releases/EducationHelper-1.5.0-linux-source.tar.gz"
ARCHIVE_SHA256="bb2164713c66bdeb188fb25046fc0015a5bf4bad8919d004c4e8ff4f058bd2ba"
APP_BASE="/opt/educationhelper"
RELEASE_DIR="$APP_BASE/releases/$VERSION"
CURRENT_LINK="$APP_BASE/current"
DATA_DIR="/var/lib/educationhelper"
CONFIG_DIR="/etc/educationhelper"
WEB_PORT="${EH_PORT:-5173}"
INSTALL_PROXY_URL="${EH_INSTALL_PROXY_URL:-}"
RUNTIME_PROXY_URL="${EH_RUNTIME_PROXY_URL:-}"

log() { printf '[EducationHelper] %s\n' "$*"; }
fail() { printf '[EducationHelper] ERROR: %s\n' "$*" >&2; exit 1; }

version_ge() {
  local current_major current_minor current_patch required_major required_minor required_patch
  IFS=. read -r current_major current_minor current_patch <<<"$1"
  IFS=. read -r required_major required_minor required_patch <<<"$2"
  current_major="${current_major:-0}"; current_minor="${current_minor:-0}"; current_patch="${current_patch:-0}"
  required_major="${required_major:-0}"; required_minor="${required_minor:-0}"; required_patch="${required_patch:-0}"
  (( current_major > required_major \
    || (current_major == required_major && current_minor > required_minor) \
    || (current_major == required_major && current_minor == required_minor && current_patch >= required_patch) ))
}

fetch_to() {
  local destination="$1"
  local url="$2"
  if command -v curl >/dev/null 2>&1; then
    "${download_env[@]}" curl --fail --location --retry 3 --connect-timeout 20 \
      --output "$destination" "$url"
  elif command -v wget >/dev/null 2>&1; then
    "${download_env[@]}" wget --quiet --tries=3 --timeout=20 \
      --output-document="$destination" "$url"
  elif command -v python3 >/dev/null 2>&1; then
    "${download_env[@]}" python3 - "$url" "$destination" <<'PY'
import sys
import urllib.request

url, destination = sys.argv[1:]
with urllib.request.urlopen(url, timeout=30) as response, open(destination, "wb") as output:
    output.write(response.read())
PY
  else
    fail "curl, wget, or python3 is required to download release files"
  fi
}

[[ "$WEB_PORT" =~ ^[0-9]+$ ]] && (( WEB_PORT >= 1024 && WEB_PORT <= 65535 )) \
  || fail "EH_PORT must be an unprivileged TCP port between 1024 and 65535"

for proxy_value in "$INSTALL_PROXY_URL" "$RUNTIME_PROXY_URL"; do
  if [[ -n "$proxy_value" && ! "$proxy_value" =~ ^https?://[A-Za-z0-9._:-]+$ ]]; then
    fail "Proxy URLs must look like http://host:port"
  fi
done

if (( EUID == 0 )); then
  SERVICE_USER="${EH_SERVICE_USER:-}"
  [[ -n "$SERVICE_USER" ]] || fail "Run as a normal administrator user, or set EH_SERVICE_USER"
else
  SERVICE_USER="${EH_SERVICE_USER:-$(id -un)}"
fi
id "$SERVICE_USER" >/dev/null 2>&1 || fail "Service user does not exist: $SERVICE_USER"
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
[[ -n "$SERVICE_HOME" ]] || fail "Could not determine the service user's home directory"
PIXI_BIN="$SERVICE_HOME/.pixi/bin/pixi"

command -v sudo >/dev/null 2>&1 || fail "sudo is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v systemctl >/dev/null 2>&1 || fail "systemd is required"

log "Requesting administrator privileges once"
sudo -v

if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$WEB_PORT" 2>/dev/null | grep -q .; then
  if ! systemctl is-active --quiet educationhelper-web.service 2>/dev/null; then
    fail "TCP port $WEB_PORT is already in use; rerun with EH_PORT=<another port>"
  fi
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT
archive="$tmp_dir/educationhelper.tar.gz"
download_env=()
if [[ -n "$INSTALL_PROXY_URL" ]]; then
  download_env=(env "HTTP_PROXY=$INSTALL_PROXY_URL" "HTTPS_PROXY=$INSTALL_PROXY_URL" "http_proxy=$INSTALL_PROXY_URL" "https_proxy=$INSTALL_PROXY_URL")
fi

log "Downloading the signed release archive"
fetch_to "$archive" "$ARCHIVE_URL"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$archive" | sha256sum --check --status \
  || fail "Release archive checksum mismatch"

staged="$tmp_dir/release"
mkdir -p "$staged"
tar -xzf "$archive" --strip-components=1 -C "$staged"
[[ -f "$staged/pixi.toml" && -f "$staged/web/package.json" ]] \
  || fail "Release archive is incomplete"

log "Staging program files without touching existing data"
sudo mkdir -p "$APP_BASE/releases" "$DATA_DIR/workspace" "$DATA_DIR/appdata" \
  "$DATA_DIR/config" "$CONFIG_DIR"
if [[ -e "$RELEASE_DIR" ]]; then
  backup_release="$APP_BASE/releases/${VERSION}.previous.$(date +%Y%m%d%H%M%S)"
  sudo mv -- "$RELEASE_DIR" "$backup_release"
  log "Preserved the previous program release at $backup_release"
fi
sudo mv -- "$staged" "$RELEASE_DIR"
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$RELEASE_DIR" "$DATA_DIR"
sudo ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

pixi_needs_install=1
if [[ -x "$PIXI_BIN" ]]; then
  installed_pixi_version="$("$PIXI_BIN" --version 2>/dev/null | awk '{print $2}')"
  if [[ -n "$installed_pixi_version" ]] && version_ge "$installed_pixi_version" "$PIXI_MIN_VERSION"; then
    pixi_needs_install=0
  else
    log "Updating Pixi ${installed_pixi_version:-unknown} for lock-file version 7 support"
  fi
fi

if (( pixi_needs_install )); then
  log "Installing Pixi $PIXI_MIN_VERSION for $SERVICE_USER"
  pixi_installer="$tmp_dir/install-pixi.sh"
  fetch_to "$pixi_installer" https://pixi.sh/install.sh
  chmod 700 "$pixi_installer"
  if [[ -n "$INSTALL_PROXY_URL" ]]; then
    sudo -u "$SERVICE_USER" env HOME="$SERVICE_HOME" PIXI_VERSION="v$PIXI_MIN_VERSION" \
      HTTP_PROXY="$INSTALL_PROXY_URL" HTTPS_PROXY="$INSTALL_PROXY_URL" \
      bash "$pixi_installer"
  else
    sudo -u "$SERVICE_USER" env HOME="$SERVICE_HOME" PIXI_VERSION="v$PIXI_MIN_VERSION" \
      bash "$pixi_installer"
  fi
fi
[[ -x "$PIXI_BIN" ]] || fail "Pixi installation did not produce $PIXI_BIN"

runtime_env=(HOME="$SERVICE_HOME")
if [[ -n "$INSTALL_PROXY_URL" ]]; then
  runtime_env+=(HTTP_PROXY="$INSTALL_PROXY_URL" HTTPS_PROXY="$INSTALL_PROXY_URL" http_proxy="$INSTALL_PROXY_URL" https_proxy="$INSTALL_PROXY_URL")
fi

log "Installing locked dependencies and building the Web interface"
sudo -u "$SERVICE_USER" env "${runtime_env[@]}" \
  "$PIXI_BIN" install --manifest-path "$RELEASE_DIR/pixi.toml" --frozen
sudo -u "$SERVICE_USER" env "${runtime_env[@]}" \
  "$PIXI_BIN" run --manifest-path "$RELEASE_DIR/pixi.toml" --frozen bootstrap
sudo -u "$SERVICE_USER" env "${runtime_env[@]}" \
  "$PIXI_BIN" run --manifest-path "$RELEASE_DIR/pixi.toml" --frozen build
[[ -f "$RELEASE_DIR/web/dist/index.html" ]] || fail "Web build did not produce dist/index.html"

control_token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
proxy_lines=""
if [[ -n "$RUNTIME_PROXY_URL" ]]; then
  proxy_lines=$(printf 'HTTP_PROXY=%s\nHTTPS_PROXY=%s\nhttp_proxy=%s\nhttps_proxy=%s\n' \
    "$RUNTIME_PROXY_URL" "$RUNTIME_PROXY_URL" "$RUNTIME_PROXY_URL" "$RUNTIME_PROXY_URL")
fi

env_file="$tmp_dir/educationhelper.env"
cat >"$env_file" <<EOF
PYTHONUNBUFFERED=1
PYTHONNOUSERSITE=1
XDG_DATA_HOME=$DATA_DIR/appdata
XDG_CONFIG_HOME=$DATA_DIR/config
SOLAIRE_PUBLIC_MODE=1
SOLAIRE_PROJECT_ROOT=$DATA_DIR/workspace
SOLAIRE_BIND_PROJECT_FROM_ENV=1
SOLAIRE_CONTROL_TOKEN=$control_token
$proxy_lines
EOF
sudo install -m 600 -o root -g root "$env_file" "$CONFIG_DIR/educationhelper.env"

backend_unit="$tmp_dir/educationhelper-backend.service"
cat >"$backend_unit" <<EOF
[Unit]
Description=EducationHelper backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$CURRENT_LINK
Environment=HOME=$SERVICE_HOME
EnvironmentFile=$CONFIG_DIR/educationhelper.env
ExecStart=$PIXI_BIN run --manifest-path $CURRENT_LINK/pixi.toml --frozen python -m uvicorn solaire.web.app:app --app-dir $CURRENT_LINK/src --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

web_unit="$tmp_dir/educationhelper-web.service"
cat >"$web_unit" <<EOF
[Unit]
Description=EducationHelper Web interface
After=network-online.target educationhelper-backend.service
Wants=network-online.target
Requires=educationhelper-backend.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$CURRENT_LINK/web
Environment=HOME=$SERVICE_HOME
EnvironmentFile=$CONFIG_DIR/educationhelper.env
ExecStart=$PIXI_BIN run --manifest-path $CURRENT_LINK/pixi.toml --frozen npm run preview -- --host 0.0.0.0 --port $WEB_PORT --strictPort
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

sudo install -m 644 "$backend_unit" /etc/systemd/system/educationhelper-backend.service
sudo install -m 644 "$web_unit" /etc/systemd/system/educationhelper-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now educationhelper-backend.service educationhelper-web.service

if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow "$WEB_PORT/tcp" comment 'EducationHelper LAN'
elif command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port="$WEB_PORT/tcp"
  sudo firewall-cmd --reload
fi

log "Waiting for health checks"
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8000/api/health >/dev/null \
    && curl --fail --silent "http://127.0.0.1:$WEB_PORT/" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8000/api/health >/dev/null \
  || { sudo journalctl -u educationhelper-backend.service -n 40 --no-pager; fail "Backend health check failed"; }
curl --fail --silent "http://127.0.0.1:$WEB_PORT/" >/dev/null \
  || { sudo journalctl -u educationhelper-web.service -n 40 --no-pager; fail "Web health check failed"; }

lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$lan_ip" ]] || lan_ip="<linux-ip>"
printf '\nEducationHelper %s is running.\n' "$VERSION"
printf 'LAN address: http://%s:%s\n' "$lan_ip" "$WEB_PORT"
printf 'Health check: OK\n'
printf 'Services: educationhelper-backend.service, educationhelper-web.service\n'
