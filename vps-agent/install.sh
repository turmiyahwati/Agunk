#!/usr/bin/env bash
# PT SONTOLOYO VPS Monitoring Agent — installer for Debian/Ubuntu.
# Developed by PAKDE XRESX DIGITAL STORE.
#
# Usage (run as root on the VPS target):
#   sudo bash install.sh                                # auto-generate API key
#   sudo MONITOR_API_KEY="strong-key" bash install.sh   # use existing key
#   sudo MONITOR_PORT=8787 bash install.sh              # change port
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# Backward-compat: accept legacy AGUNK_* env vars if MONITOR_* not set.
API_KEY="${MONITOR_API_KEY:-${AGUNK_API_KEY:-}}"
HOST="${MONITOR_HOST:-${AGUNK_HOST:-0.0.0.0}}"
PORT="${MONITOR_PORT:-${AGUNK_PORT:-8787}}"

if [[ -z "${API_KEY}" ]]; then
  API_KEY="$(openssl rand -hex 24)"
  echo ">> Generated API key: ${API_KEY}"
fi

echo ">> Installing system packages..."
apt-get update -y
apt-get install -y python3 python3-venv python3-pip iproute2 iputils-ping curl vnstat

INSTALL_DIR=/opt/ptsontoloyo-agent
mkdir -p "${INSTALL_DIR}"

# Copy files from this folder (must contain agunk_agent.py + requirements.txt + service file).
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "${SRC_DIR}/agunk_agent.py"   "${INSTALL_DIR}/agunk_agent.py"
cp "${SRC_DIR}/requirements.txt" "${INSTALL_DIR}/requirements.txt"

echo ">> Creating virtualenv..."
python3 -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip
"${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo ">> Writing environment file..."
cat >/etc/ptsontoloyo-agent.env <<EOF
MONITOR_API_KEY=${API_KEY}
MONITOR_HOST=${HOST}
MONITOR_PORT=${PORT}
EOF
chmod 600 /etc/ptsontoloyo-agent.env

# Migrate from previous "agunk-agent" install if present (best-effort, non-destructive).
if [[ -f /etc/systemd/system/agunk-agent.service ]]; then
  echo ">> Detected legacy agunk-agent.service — disabling cleanly..."
  systemctl disable --now agunk-agent.service || true
  rm -f /etc/systemd/system/agunk-agent.service
  rm -f /etc/agunk-agent.env
  rm -rf /opt/agunk-agent
fi

echo ">> Installing systemd service..."
cp "${SRC_DIR}/ptsontoloyo-agent.service" /etc/systemd/system/ptsontoloyo-agent.service
systemctl daemon-reload
systemctl enable --now ptsontoloyo-agent.service

# vnstat (network traffic counter) needs its DB initialised once
if command -v vnstat >/dev/null 2>&1; then
  systemctl enable --now vnstat || true
fi

# Allow firewall (best-effort)
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PORT}/tcp" || true
fi

sleep 1
IP_ADDR="$(hostname -I | awk '{print $1}')"
echo
echo "=========================================================="
echo " PT SONTOLOYO Monitor Agent installed."
echo " Developed by PAKDE XRESX DIGITAL STORE"
echo "----------------------------------------------------------"
echo " URL:     http://${IP_ADDR}:${PORT}"
echo " Health:  curl http://127.0.0.1:${PORT}/health"
echo " API key: ${API_KEY}"
echo
echo " Test status (paste at the dashboard):"
echo "   curl -H \"X-API-Key: ${API_KEY}\" http://127.0.0.1:${PORT}/api/status"
echo
echo " Logs:    journalctl -u ptsontoloyo-agent -f"
echo " Restart: systemctl restart ptsontoloyo-agent"
echo "=========================================================="
