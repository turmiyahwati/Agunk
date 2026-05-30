#!/usr/bin/env bash
# PT Sontoloyo Monitor — VPS Agent installer for Debian / Ubuntu.
#
# Usage:
#   sudo SONTOLOYO_API_KEY="strong-key" bash install.sh
# Or with a port override:
#   sudo SONTOLOYO_API_KEY="..." SONTOLOYO_PORT=8787 bash install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

API_KEY="${SONTOLOYO_API_KEY:-}"
HOST="${SONTOLOYO_HOST:-0.0.0.0}"
PORT="${SONTOLOYO_PORT:-8787}"

if [[ -z "${API_KEY}" ]]; then
  API_KEY="$(openssl rand -hex 24)"
  echo ">> Generated API key: ${API_KEY}"
fi

echo ">> Installing system packages..."
apt-get update -y
apt-get install -y python3 python3-venv python3-pip iproute2 iputils-ping curl ca-certificates gnupg

# ─── Ookla Speedtest CLI ────────────────────────────────────────────────
# Used by the agent to refresh the "Tested Speed" tier on the dashboard
# once per day at the configured off-peak hour. If the install fails
# (sanctioned region, mirror down, etc.), the agent gracefully falls
# back to reporting only the realtime RX/TX numbers — the dashboard
# shows "Belum diuji" for the tested tier and keeps working.
if ! command -v speedtest >/dev/null 2>&1; then
  echo ">> Installing Ookla Speedtest CLI..."
  if curl -fsSL https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash; then
    apt-get install -y speedtest || \
      echo ">> WARNING: speedtest install failed — agent will skip daily benchmark." >&2
  else
    echo ">> WARNING: could not add Ookla repo — daily speedtest will be disabled." >&2
  fi
fi

# Pre-accept the Ookla CLI license so the scheduler can run it
# non-interactively. Re-running this on an already-accepted host is a
# no-op.
if command -v speedtest >/dev/null 2>&1; then
  speedtest --accept-license --accept-gdpr --version >/dev/null 2>&1 || true
fi

# State directory for the persisted speedtest cache. The systemd unit
# also declares `StateDirectory=sontoloyo` which would create this on
# first start, but we make it explicit here so a manual `speedtest`
# invocation (operator debugging) can write its result before the
# service has run for the first time.
mkdir -p /var/lib/sontoloyo
chmod 755 /var/lib/sontoloyo

INSTALL_DIR=/opt/sontoloyo-agent
mkdir -p "${INSTALL_DIR}"

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "${SRC_DIR}/sontoloyo_agent.py" "${INSTALL_DIR}/sontoloyo_agent.py"
cp "${SRC_DIR}/requirements.txt"   "${INSTALL_DIR}/requirements.txt"

echo ">> Creating virtualenv..."
python3 -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip
"${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo ">> Writing environment file..."
cat >/etc/sontoloyo-agent.env <<EOF
SONTOLOYO_API_KEY=${API_KEY}
SONTOLOYO_HOST=${HOST}
SONTOLOYO_PORT=${PORT}
EOF
chmod 600 /etc/sontoloyo-agent.env

echo ">> Installing systemd service..."
cp "${SRC_DIR}/sontoloyo-agent.service" /etc/systemd/system/sontoloyo-agent.service
systemctl daemon-reload
systemctl enable sontoloyo-agent.service
# Use restart (not "enable --now") so re-installs reload the new env file.
# `enable --now` is a no-op when the service is already running, which means
# a fresh install on a host that previously ran the agent will keep the OLD
# API key in memory while the env file holds the NEW key — leading to
# `{"detail":"invalid api key"}` on every call. Always restart explicitly.
systemctl restart sontoloyo-agent.service

if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PORT}/tcp" || true
fi

sleep 1
echo
echo "=========================================================="
echo " PT Sontoloyo Monitor — VPS Agent installed."
echo " URL:     http://$(hostname -I | awk '{print $1}'):${PORT}"
echo " Health:  curl http://127.0.0.1:${PORT}/health"
echo " API key: ${API_KEY}"
echo
echo " Test status:"
echo "   curl -H \"X-API-Key: ${API_KEY}\" http://127.0.0.1:${PORT}/api/status"
echo
echo " Logs:    journalctl -u sontoloyo-agent -f"
echo "=========================================================="
