#!/usr/bin/env bash
# =============================================================================
# PT Sontoloyo Monitor — Disaster recovery / restore script.
# =============================================================================
#
# Restores a dashboard from a backup tarball produced by scripts/backup-all.sh.
# Designed to run on a freshly-provisioned Ubuntu VPS that has just been
# bootstrapped via install-dashboard.sh — i.e. all system deps + repo are in
# place, but the database is empty and no operator state is loaded.
#
# Usage:
#
#   sudo bash scripts/restore.sh /path/to/sontoloyo-backup-host-<TS>.tar.gz.enc
#   sudo bash scripts/restore.sh /path/to/sontoloyo-backup-host-<TS>.tar.gz   # unencrypted
#
# Prompts for the decryption passphrase if the file is .enc (or reads from
# SONTOLOYO_BACKUP_PASSPHRASE if set).
#
# What it restores:
#   • prisma/prod.db
#   • .env
#   • public/uploads/
#   • /etc/ssl/cloudflare/origin.{pem,key}
#   • /etc/nginx/sites-available/sontoloyo (if present in archive)
#
# After restore, it:
#   • Re-runs `prisma generate` (in case the schema moved between versions)
#   • Reloads PM2 + nginx
#   • Smoke-tests the dashboard
#
# Idempotent: existing files are saved as <name>.before-restore.<TS> so the
# restore can be undone if it goes sideways.
# =============================================================================

set -euo pipefail

# ─── Logging ─────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_BOLD=""; C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""
fi
log()  { echo "${C_CYAN}[$(date +%H:%M:%S)]${C_RESET} $*"; }
ok()   { echo "${C_GREEN}✓${C_RESET}  $*"; }
warn() { echo "${C_YELLOW}⚠${C_RESET}  $*" >&2; }
err()  { echo "${C_RED}✗${C_RESET}  $*" >&2; }
die()  { err "$*"; exit 1; }

# ─── Pre-flight ──────────────────────────────────────────────────────────
[[ "${EUID}" -eq 0 ]] || die "Run as root: sudo bash restore.sh <backup-file>"
[[ "$#" -eq 1 ]]      || die "Usage: sudo bash restore.sh <backup-file.tar.gz[.enc]>"

BACKUP_FILE="$1"
[[ -f "${BACKUP_FILE}" ]] || die "Backup file not found: ${BACKUP_FILE}"

INSTALL_DIR="${SONTOLOYO_INSTALL_DIR:-/root/sontoloyo-monitor}"
[[ -d "${INSTALL_DIR}/.git" ]] || die "Install dir ${INSTALL_DIR} is not a git checkout. Run install-dashboard.sh first."

WORK_DIR="$(mktemp -d -t sontoloyo-restore.XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT
TS_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"

cat <<HEADER

  ╔═══════════════════════════════════════════════════════════════════╗
  ║      PT Sontoloyo Monitor — Disaster Recovery Restore             ║
  ╚═══════════════════════════════════════════════════════════════════╝

  Backup file  : ${BACKUP_FILE}
  Install dir  : ${INSTALL_DIR}
  Workspace    : ${WORK_DIR}

HEADER

# ─── 1. Decrypt if needed ───────────────────────────────────────────────
if [[ "${BACKUP_FILE}" == *.enc ]]; then
  log "Encrypted archive detected — decrypting…"
  PASSPHRASE="${SONTOLOYO_BACKUP_PASSPHRASE:-}"
  if [[ -z "${PASSPHRASE}" ]]; then
    if [[ -t 0 ]]; then
      read -rsp "${C_BOLD}Decryption passphrase:${C_RESET} " PASSPHRASE
      echo
    else
      die "Passphrase required. Set SONTOLOYO_BACKUP_PASSPHRASE or run interactively."
    fi
  fi
  TAR_FILE="${WORK_DIR}/backup.tar.gz"
  if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
    -in "${BACKUP_FILE}" \
    -out "${TAR_FILE}" \
    -pass "pass:${PASSPHRASE}" 2>/dev/null; then
    die "Decryption failed — wrong passphrase?"
  fi
  ok "Decrypted."
else
  TAR_FILE="${BACKUP_FILE}"
  warn "Backup is not encrypted. Consider setting SONTOLOYO_BACKUP_PASSPHRASE on the source host going forward."
fi

# ─── 2. Extract ──────────────────────────────────────────────────────────
log "Extracting archive…"
EXTRACT_DIR="${WORK_DIR}/extract"
mkdir -p "${EXTRACT_DIR}"
tar -xzf "${TAR_FILE}" -C "${EXTRACT_DIR}"
ok "Extracted."

# ─── 3. Show manifest summary ───────────────────────────────────────────
if [[ -f "${EXTRACT_DIR}/manifest.json" ]]; then
  log "Manifest:"
  if command -v jq >/dev/null 2>&1; then
    jq -r '"  • created   : \(.created_at)\n  • host      : \(.host)\n  • git commit: \(.git_commit)\n  • version   : \(.package_version)\n  • encrypted : \(.encrypted)"' \
      "${EXTRACT_DIR}/manifest.json"
  else
    cat "${EXTRACT_DIR}/manifest.json"
  fi
fi

# ─── 4. Confirm with operator ────────────────────────────────────────────
echo
warn "About to overwrite live state in ${INSTALL_DIR} and /etc/{ssl,nginx}."
warn "Existing files will be backed up as <name>.before-restore.${TS_SUFFIX}"
echo
if [[ -t 0 && "${SONTOLOYO_RESTORE_YES:-0}" != "1" ]]; then
  read -rp "${C_BOLD}Type 'restore' to proceed:${C_RESET} " CONFIRM
  [[ "${CONFIRM}" == "restore" ]] || die "Aborted by operator."
fi

# Helper: backup existing file before overwriting.
safe_overwrite() {
  local src="$1" dst="$2"
  if [[ -e "${dst}" ]]; then
    mv "${dst}" "${dst}.before-restore.${TS_SUFFIX}"
  fi
  cp -a "${src}" "${dst}"
}

# ─── 5. Stop services to avoid partial reads ────────────────────────────
log "Pausing services for atomic restore…"
pm2 stop sontoloyo 2>/dev/null || true

# ─── 6. Restore files ────────────────────────────────────────────────────
if [[ -f "${EXTRACT_DIR}/prod.db" ]]; then
  mkdir -p "${INSTALL_DIR}/prisma"
  safe_overwrite "${EXTRACT_DIR}/prod.db" "${INSTALL_DIR}/prisma/prod.db"
  ok "Database restored."
else
  warn "No prod.db in archive. Skipping DB restore."
fi

if [[ -f "${EXTRACT_DIR}/env" ]]; then
  safe_overwrite "${EXTRACT_DIR}/env" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  ok ".env restored."
fi

if [[ -d "${EXTRACT_DIR}/uploads" ]]; then
  rm -rf "${INSTALL_DIR}/public/uploads.before-restore.${TS_SUFFIX}" 2>/dev/null || true
  if [[ -d "${INSTALL_DIR}/public/uploads" ]]; then
    mv "${INSTALL_DIR}/public/uploads" "${INSTALL_DIR}/public/uploads.before-restore.${TS_SUFFIX}"
  fi
  cp -a "${EXTRACT_DIR}/uploads" "${INSTALL_DIR}/public/uploads"
  ok "Uploads restored."
fi

if [[ -d "${EXTRACT_DIR}/ssl" ]]; then
  mkdir -p /etc/ssl/cloudflare
  for f in origin.pem origin.key; do
    if [[ -f "${EXTRACT_DIR}/ssl/${f}" ]]; then
      safe_overwrite "${EXTRACT_DIR}/ssl/${f}" "/etc/ssl/cloudflare/${f}"
    fi
  done
  chmod 600 /etc/ssl/cloudflare/origin.key 2>/dev/null || true
  chmod 644 /etc/ssl/cloudflare/origin.pem 2>/dev/null || true
  ok "Cloudflare cert restored."
fi

if [[ -f "${EXTRACT_DIR}/nginx/sontoloyo.conf" ]]; then
  safe_overwrite "${EXTRACT_DIR}/nginx/sontoloyo.conf" "/etc/nginx/sites-available/sontoloyo"
  ln -sf /etc/nginx/sites-available/sontoloyo /etc/nginx/sites-enabled/sontoloyo
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    ok "nginx config restored + reloaded."
  else
    warn "Restored nginx config failed validation. Check /etc/nginx/sites-available/sontoloyo."
  fi
fi

# ─── 7. Re-prepare app ───────────────────────────────────────────────────
log "Re-running prisma generate (in case schema moved)…"
cd "${INSTALL_DIR}"
npx --yes prisma generate >/dev/null 2>&1 || warn "prisma generate had issues — check manually."

# ─── 8. Restart services ─────────────────────────────────────────────────
log "Restarting PM2…"
if pm2 describe sontoloyo >/dev/null 2>&1; then
  pm2 restart sontoloyo
else
  pm2 start "npm run start" --name sontoloyo --cwd "${INSTALL_DIR}"
  pm2 save
fi
sleep 3
pm2 status

# ─── 9. Smoke test ───────────────────────────────────────────────────────
log "Smoke testing…"
if curl -fsS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null | grep -q "200"; then
  ok "Dashboard responding on :3000"
else
  warn "Dashboard not responding yet — check 'pm2 logs sontoloyo'."
fi

echo
echo "${C_BOLD}${C_GREEN}╔═══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_BOLD}${C_GREEN}║       ✅  Restore complete                                        ║${C_RESET}"
echo "${C_BOLD}${C_GREEN}╚═══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo
echo "  ${C_BOLD}Pre-restore backups${C_RESET}: *.before-restore.${TS_SUFFIX}"
echo "  ${C_BOLD}Verify visually${C_RESET}    : open the dashboard URL in a browser"
echo "  ${C_BOLD}Rollback${C_RESET}           : move *.before-restore files back into place"
echo
