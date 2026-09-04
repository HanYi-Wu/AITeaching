#!/usr/bin/env bash
# Local OCR: no API key or persistent proxy required. Run AFTER upgrading EH.
set -Eeuo pipefail
trap 'printf "[EH OCR] Installation failed at line %s; fix the error above and rerun.\n" "$LINENO" >&2' ERR
command -v apt-get >/dev/null || { echo 'Ubuntu/Debian with apt-get required' >&2; exit 1; }
sudo_cmd=()
if (( EUID != 0 )); then sudo -v; sudo_cmd=(sudo); fi
apt_options=()
if [[ -n "${EH_INSTALL_PROXY_URL:-}" ]]; then
  [[ "$EH_INSTALL_PROXY_URL" =~ ^https?://[A-Za-z0-9._:-]+$ ]] || { echo 'Invalid proxy URL' >&2; exit 1; }
  apt_options=(-o "Acquire::http::Proxy=$EH_INSTALL_PROXY_URL" -o "Acquire::https::Proxy=$EH_INSTALL_PROXY_URL")
fi
echo '[EH OCR] Installing Tesseract and Chinese/English language packs'
"${sudo_cmd[@]}" apt-get "${apt_options[@]}" update
"${sudo_cmd[@]}" apt-get "${apt_options[@]}" install -y tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng
/usr/bin/tesseract --version
languages=$(/usr/bin/tesseract --list-langs)
for lang in chi_sim eng; do
  grep -qx "$lang" <<<"$languages" || { echo "Missing OCR language: $lang" >&2; exit 1; }
done
echo '[EH OCR] Ready. Upload an image to the assistant, or ask it to call doc.ocr_image. No reboot needed.'
echo '[EH OCR] Printed text is supported; handwriting, formulae and diagrams require human review.'
