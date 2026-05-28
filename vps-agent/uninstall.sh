#!/usr/bin/env bash
# PT SONTOLOYO Monitor Agent uninstaller.
# Developed by PAKDE XRESX DIGITAL STORE.
set -e
if [[ "${EUID}" -ne 0 ]]; then echo "Run as root."; exit 1; fi

# New service
systemctl disable --now ptsontoloyo-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/ptsontoloyo-agent.service
rm -rf /opt/ptsontoloyo-agent
rm -f /etc/ptsontoloyo-agent.env

# Legacy service (best-effort cleanup)
systemctl disable --now agunk-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/agunk-agent.service
rm -rf /opt/agunk-agent
rm -f /etc/agunk-agent.env

systemctl daemon-reload
echo "PT SONTOLOYO Monitor Agent removed."
