#!/usr/bin/env bash
# PT Sontoloyo Monitor — VPS Agent uninstaller.
set -e
if [[ "${EUID}" -ne 0 ]]; then echo "Run as root."; exit 1; fi
systemctl disable --now sontoloyo-agent.service || true
rm -f /etc/systemd/system/sontoloyo-agent.service
rm -rf /opt/sontoloyo-agent
rm -f /etc/sontoloyo-agent.env
systemctl daemon-reload
echo "Sontoloyo Agent removed."
