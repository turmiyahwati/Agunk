#!/usr/bin/env bash
set -e
if [[ "${EUID}" -ne 0 ]]; then echo "Run as root."; exit 1; fi
systemctl disable --now agunk-agent.service || true
rm -f /etc/systemd/system/agunk-agent.service
rm -rf /opt/agunk-agent
rm -f /etc/agunk-agent.env
systemctl daemon-reload
echo "Agunk Agent removed."
