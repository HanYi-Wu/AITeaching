#!/usr/bin/env bash
# Real systemd integration; only on an isolated disposable Linux builder.
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Only run on disposable GitHub runner'; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
tar -xzf "$root"/dist-offline/*-offline.tar.gz -C "$fixture"
package="$(find "$fixture" -name manifest.json -printf '%h\n')"
base="/opt/eh-offline-test-$GITHUB_RUN_ID"
data="/var/lib/eh-offline-test-$GITHUB_RUN_ID"
config="/etc/eh-offline-test-$GITHUB_RUN_ID"
options=(--app-base "$base" --data-dir "$data" --config-dir "$config" --port 15173 --backend-port 18000)
cleanup() {
  sudo systemctl stop educationhelper-web.service educationhelper-backend.service || true
}
trap cleanup EXIT
sudo bash "$package/install.sh" "${options[@]}"
runtime="$base/current/runtime"
for command in solaire-exam solaire-web solaire-desktop primebrush; do
  [[ -x "$runtime/bin/$command" ]] || { echo "Missing runtime console script: $command" >&2; exit 1; }
done
sudo -u educationhelper env -u PYTHONPATH -u PYTHONHOME PYTHONNOUSERSITE=1 "$runtime/bin/python" -c \
  'from importlib.metadata import distribution; names = {"solaire-exam", "solaire-web", "solaire-desktop", "primebrush"}; entries = {item.name: item for item in distribution("solaire-education").entry_points if item.group == "console_scripts"}; missing = names - entries.keys(); assert not missing, f"Missing console scripts: {sorted(missing)}"; [entries[name].load() for name in sorted(names)]; print("Runtime CLI imports: OK")'
curl -fsS --noproxy '*' -o /dev/null -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"offline-test123","display_name":"Offline CI"}' \
  http://127.0.0.1:15173/api/auth/bootstrap-admin
sudo sh -c "printf 'original business file\n' > '$data/workspace/preserved.txt'"
before="$(sudo sha256sum "$config/educationhelper.env")"
old="$(readlink -f "$base/current")"
# No package-manager/network installation is performed on either run.
sudo bash "$package/install.sh" "${options[@]}"
[[ "$(readlink -f "$base/current")" != "$old" ]]
[[ "$(sudo sha256sum "$config/educationhelper.env")" == "$before" ]]
[[ "$(sudo cat "$data/workspace/preserved.txt")" == 'original business file' ]]
curl -fsS --noproxy '*' http://127.0.0.1:15173/api/health
curl -fsS --noproxy '*' -o /dev/null -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"offline-test123"}' http://127.0.0.1:15173/api/auth/login
old="$(readlink -f "$base/current")"
# Deliberately make only the candidate frontend fail at startup, after preparation.
python - "$package" <<'PY'
import hashlib, json, pathlib, tarfile, tempfile
package = pathlib.Path(__import__('sys').argv[1])
with tempfile.TemporaryDirectory() as folder:
    with tarfile.open(package/'app.tar.gz') as source:
        source.extractall(folder, filter='data')
    path = pathlib.Path(folder)/'src/solaire/web/offline_frontend.py'
    with path.open('a') as target:
        target.write('\n@asynccontextmanager\nasync def broken(app):\n    raise RuntimeError("deliberate rollback test")\n    yield\napp = Starlette(lifespan=broken)\n')
    with tarfile.open(package/'app.tar.gz', 'w:gz') as target:
        for entry in pathlib.Path(folder).iterdir():
            target.add(entry, arcname=entry.name)
manifest = json.loads((package/'manifest.json').read_text())
manifest['sha256']['app.tar.gz'] = hashlib.sha256((package/'app.tar.gz').read_bytes()).hexdigest()
(package/'manifest.json').write_text(json.dumps(manifest))
PY
if sudo bash "$package/install.sh" "${options[@]}" --health-timeout 5; then
  echo 'Broken candidate was accepted' >&2; exit 1
fi
[[ "$(readlink -f "$base/current")" == "$old" ]]
[[ "$(sudo sha256sum "$config/educationhelper.env")" == "$before" ]]
[[ "$(sudo cat "$data/workspace/preserved.txt")" == 'original business file' ]]
curl -fsS --noproxy '*' -o /dev/null -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"offline-test123"}' http://127.0.0.1:15173/api/auth/login
sudo systemctl is-active educationhelper-web.service educationhelper-backend.service
echo 'Real offline initial install + live upgrade + failed candidate rollback + retained accounts/data/config: PASS'
