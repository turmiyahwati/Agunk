#!/usr/bin/env bash
# Agunk VPS Agent installer for Debian/Ubuntu.
# Usage:
#   sudo AGUNK_API_KEY="strong-key" bash install.sh
# Or with a port override:
#   sudo AGUNK_API_KEY="..." AGUNK_PORT=8787 bash install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

API_KEY="${AGUNK_API_KEY:-}"
HOST="${AGUNK_HOST:-0.0.0.0}"
PORT="${AGUNK_PORT:-8787}"

if [[ -z "${API_KEY}" ]]; then
  API_KEY="$(openssl rand -hex 24)"
  echo ">> Generated API key: ${API_KEY}"
fi

echo ">> Installing system packages..."
apt-get update -y
apt-get install -y python3 python3-venv python3-pip iproute2 iputils-ping curl

INSTALL_DIR=/opt/agunk-agent
mkdir -p "${INSTALL_DIR}"

# Copy this directory's files (when running locally cloned) OR download them.
# For convenience, we expect agunk_agent.py + requirements.txt next to install.sh.
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "${SRC_DIR}/agunk_agent.py"   "${INSTALL_DIR}/agunk_agent.py"
cp "${SRC_DIR}/requirements.txt" "${INSTALL_DIR}/requirements.txt"

echo ">> Creating virtualenv..."
python3 -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip
"${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo ">> Writing environment file..."
cat >/etc/agunk-agent.env <<EOF
AGUNK_API_KEY=${API_KEY}
AGUNK_HOST=${HOST}
AGUNK_PORT=${PORT}
EOF
chmod 600 /etc/agunk-agent.env

echo ">> Installing systemd service..."
cp "${SRC_DIR}/agunk-agent.service" /etc/systemd/system/agunk-agent.service
systemctl daemon-reload
systemctl enable --now agunk-agent.service

# Allow firewall (best-effort)
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PORT}/tcp" || true
fi

sleep 1
echo
echo "=========================================================="
echo " Agunk Agent installed."
echo " URL:     http://$(hostname -I | awk '{print $1}'):${PORT}"
echo " Health:  curl http://127.0.0.1:${PORT}/health"
echo " API key: ${API_KEY}"
echo
echo " Test status:"
echo "   curl -H \"X-API-Key: ${API_KEY}\" http://127.0.0.1:${PORT}/api/status"
echo
echo " Logs:    journalctl -u agunk-agent -f"
echo "=========================================================="
