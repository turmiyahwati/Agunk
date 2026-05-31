#!/usr/bin/env bash
# =============================================================================
# PT Sontoloyo Monitor — Full encrypted backup (designed for cron + DR).
# =============================================================================
#
# Bundles everything an operator needs to rebuild the dashboard on a fresh
# VPS into ONE encrypted archive:
#
#   backup-<ISO>.tar.gz.enc
#   ├── prod.db                # SQLite database snapshot
#   ├── env                    # .env (renamed for clarity)
#   ├── uploads/               # operator-uploaded logo, etc.
#   ├── ssl/origin.pem         # Cloudflare Origin Certificate
#   ├── ssl/origin.key         # Cloudflare Origin private key
#   ├── nginx/sontoloyo.conf   # nginx site config
#   └── manifest.json          # version + checksums + paths
#
# Encryption: AES-256-CBC via openssl (PBKDF2 100k iterations). The
# passphrase is read from the SONTOLOYO_BACKUP_PASSPHRASE env var (set
# in /root/sontoloyo-monitor/.env) — without it, the script falls back
# to plain unencrypted .tar.gz so backups still happen for operators
# who haven't configured encryption yet, with a loud warning.
#
# Old backups beyond BACKUP_RETENTION_DAYS (default 14) are deleted.
#
# Usage:
#
#   bash scripts/backup-all.sh                 # local only, write to /root/sontoloyo-backups/
#   SONTOLOYO_BACKUP_REMOTE=rclone:r2:bucket bash scripts/backup-all.sh
#
# Cron (auto-installed by install-dashboard.sh):
#
#   30 2 * * * root cd /root/sontoloyo-monitor && bash scripts/backup-all.sh \
#                   >> /var/log/sontoloyo-backup.log 2>&1
# =============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────
INSTALL_DIR="${SONTOLOYO_INSTALL_DIR:-/root/sontoloyo-monitor}"
BACKUP_DIR="${SONTOLOYO_BACKUP_DIR:-/root/sontoloyo-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOSTNAME_ID="$(hostname -s | tr -c 'A-Za-z0-9' '-' | sed 's/-*$//')"
ARCHIVE_BASE="sontoloyo-backup-${HOSTNAME_ID}-${TIMESTAMP}"

# Pull encryption passphrase from .env (idempotent — even if the script
# is invoked from cron with an empty environment).
if [[ -z "${SONTOLOYO_BACKUP_PASSPHRASE:-}" && -f "${INSTALL_DIR}/.env" ]]; then
  SONTOLOYO_BACKUP_PASSPHRASE="$(grep '^SONTOLOYO_BACKUP_PASSPHRASE=' "${INSTALL_DIR}/.env" | cut -d'"' -f2 || true)"
fi

# ─── Logging ─────────────────────────────────────────────────────────────
log()  { echo "[$(date +%H:%M:%S)] $*"; }
warn() { echo "[$(date +%H:%M:%S)] WARN: $*" >&2; }
die()  { echo "[$(date +%H:%M:%S)] ERROR: $*" >&2; exit 1; }

# ─── Pre-flight ──────────────────────────────────────────────────────────
[[ -d "${INSTALL_DIR}" ]] || die "Install dir not found: ${INSTALL_DIR}"
mkdir -p "${BACKUP_DIR}"
WORK_DIR="$(mktemp -d -t sontoloyo-backup.XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

log "Backup workspace: ${WORK_DIR}"

# ─── 1. SQLite database (prefer prisma/<X>.db; fall back gracefully) ────
DB_URL="$(grep '^DATABASE_URL=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d'"' -f2 || echo "file:./prod.db")"
if [[ "${DB_URL}" == file:* ]]; then
  REL="${DB_URL#file:}"
  REL="${REL#./}"
  for candidate in "${INSTALL_DIR}/prisma/${REL}" "${INSTALL_DIR}/${REL}"; do
    if [[ -f "${candidate}" ]]; then
      cp "${candidate}" "${WORK_DIR}/prod.db"
      # SQLite VACUUM creates a clean copy that survives even if the
      # source is being written to by Prisma at the same instant.
      sqlite3 "${WORK_DIR}/prod.db" "VACUUM;" 2>/dev/null || true
      log "✓ database snapshot: $(du -h "${WORK_DIR}/prod.db" | cut -f1)"
      break
    fi
  done
  if [[ ! -f "${WORK_DIR}/prod.db" ]]; then
    warn "SQLite file not found for ${DB_URL}"
  fi
else
  warn "DATABASE_URL is not a SQLite file (${DB_URL%%://*}://…) — DB backup skipped."
  warn "Configure pg_dump/mysqldump in your own cron for non-SQLite setups."
fi

# ─── 2. .env (renamed → 'env' so tar listing is not surprising) ─────────
if [[ -f "${INSTALL_DIR}/.env" ]]; then
  cp "${INSTALL_DIR}/.env" "${WORK_DIR}/env"
  log "✓ .env captured"
fi

# ─── 3. Operator-uploaded assets ────────────────────────────────────────
if [[ -d "${INSTALL_DIR}/public/uploads" ]]; then
  cp -a "${INSTALL_DIR}/public/uploads" "${WORK_DIR}/uploads"
  log "✓ uploads/ captured ($(find "${WORK_DIR}/uploads" -type f 2>/dev/null | wc -l) files)"
fi

# ─── 4. Cloudflare Origin certificate ───────────────────────────────────
if [[ -d /etc/ssl/cloudflare ]]; then
  mkdir -p "${WORK_DIR}/ssl"
  for f in origin.pem origin.key; do
    [[ -f "/etc/ssl/cloudflare/${f}" ]] && cp "/etc/ssl/cloudflare/${f}" "${WORK_DIR}/ssl/${f}"
  done
  log "✓ Cloudflare certs captured"
fi

# ─── 5. nginx site config ───────────────────────────────────────────────
if [[ -f /etc/nginx/sites-available/sontoloyo ]]; then
  mkdir -p "${WORK_DIR}/nginx"
  cp /etc/nginx/sites-available/sontoloyo "${WORK_DIR}/nginx/sontoloyo.conf"
  log "✓ nginx config captured"
fi

# ─── 6. Manifest (helpful for restore + audit) ──────────────────────────
NEXT_VERSION="$(node -e "console.log(require('${INSTALL_DIR}/package.json').version)" 2>/dev/null || echo unknown)"
GIT_HASH="$(git -C "${INSTALL_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"

# Compute checksums for tamper-evidence.
checksums=""
for f in $(find "${WORK_DIR}" -type f); do
  rel="${f#${WORK_DIR}/}"
  hash="$(sha256sum "$f" | cut -d' ' -f1)"
  checksums+="    \"${rel}\": \"${hash}\",
"
done
checksums="${checksums%,*}"

cat > "${WORK_DIR}/manifest.json" <<EOF
{
  "format_version": 1,
  "package_version": "${NEXT_VERSION}",
  "git_commit": "${GIT_HASH}",
  "created_at": "$(date -Iseconds)",
  "host": "$(hostname -f 2>/dev/null || hostname)",
  "install_dir": "${INSTALL_DIR}",
  "encrypted": $([[ -n "${SONTOLOYO_BACKUP_PASSPHRASE:-}" ]] && echo "true" || echo "false"),
  "files": {
${checksums}
  }
}
EOF
log "✓ manifest.json written"

# ─── 7. Pack the tarball ────────────────────────────────────────────────
TAR_PATH="${BACKUP_DIR}/${ARCHIVE_BASE}.tar.gz"
( cd "${WORK_DIR}" && tar -czf "${TAR_PATH}" . )
chmod 600 "${TAR_PATH}"
TAR_SIZE="$(du -h "${TAR_PATH}" | cut -f1)"
log "✓ tarball: ${TAR_PATH} (${TAR_SIZE})"

# ─── 8. Encrypt (or warn if no passphrase) ──────────────────────────────
FINAL_PATH="${TAR_PATH}"
if [[ -n "${SONTOLOYO_BACKUP_PASSPHRASE:-}" ]]; then
  ENC_PATH="${TAR_PATH}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
    -in "${TAR_PATH}" \
    -out "${ENC_PATH}" \
    -pass "pass:${SONTOLOYO_BACKUP_PASSPHRASE}"
  rm -f "${TAR_PATH}"
  chmod 600 "${ENC_PATH}"
  FINAL_PATH="${ENC_PATH}"
  log "✓ encrypted: ${FINAL_PATH} ($(du -h "${FINAL_PATH}" | cut -f1))"
else
  warn "SONTOLOYO_BACKUP_PASSPHRASE not set — backup is UNENCRYPTED."
  warn "  Set it in ${INSTALL_DIR}/.env to enable AES-256-CBC encryption."
fi

# ─── 9. Optional: ship to remote (rclone) ────────────────────────────────
if [[ -n "${SONTOLOYO_BACKUP_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    log "Uploading to ${SONTOLOYO_BACKUP_REMOTE}…"
    rclone copy "${FINAL_PATH}" "${SONTOLOYO_BACKUP_REMOTE}/" --quiet
    log "✓ remote upload complete"
  else
    warn "SONTOLOYO_BACKUP_REMOTE set but rclone not installed."
    warn "  Install rclone: 'curl https://rclone.org/install.sh | sudo bash'"
  fi
fi

# ─── 10. Retention prune ────────────────────────────────────────────────
log "Pruning backups older than ${RETENTION_DAYS} day(s)…"
find "${BACKUP_DIR}" -maxdepth 1 -name "sontoloyo-backup-*.tar.gz*" -mtime "+${RETENTION_DAYS}" -print -delete | while read -r del; do
  log "  removed: ${del}"
done

log "DONE — backup ready at ${FINAL_PATH}"
