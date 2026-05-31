#!/usr/bin/env bash
# =============================================================================
# PT Sontoloyo Monitor — One-command dashboard installer for Ubuntu 24.04
# =============================================================================
#
# Provisions a fresh Ubuntu 24.04 LTS server into a production-ready dashboard:
# system prep → Node 20 → PM2 → nginx → repo clone → .env wizard → DB init →
# PM2 + systemd → nginx config → cron auto-sync + backup → smoke test.
#
# Cloudflare-related steps (DNS records, SSL Origin certificate, WAF rules,
# Tunnel for agents) are INTENTIONALLY left manual. The installer pauses with
# clear instructions when a Cloudflare action is required, so operators retain
# full control of their account and never lock themselves out by mistake.
#
# Usage:
#
#   curl -fsSL https://raw.githubusercontent.com/turmiyahwati/Agunk/main/scripts/install-dashboard.sh | sudo bash
#
# or, if the repo is already cloned:
#
#   sudo bash scripts/install-dashboard.sh
#
# Environment overrides (all optional — interactive prompts otherwise):
#
#   SONTOLOYO_DOMAIN          dashboard public hostname (e.g. monitoring.example.com)
#   SONTOLOYO_ADMIN_EMAIL     admin login email
#   SONTOLOYO_ADMIN_PASSWORD  admin login password (auto-generated if absent)
#   SONTOLOYO_REPO            git URL (default: https://github.com/turmiyahwati/Agunk.git)
#   SONTOLOYO_INSTALL_DIR     install path (default: /root/sontoloyo-monitor)
#   SONTOLOYO_BRANCH          git branch (default: main)
#   SONTOLOYO_NON_INTERACTIVE set to "1" to skip every prompt; relies on env vars
#   SONTOLOYO_SKIP_NGINX      set to "1" to skip nginx config (run behind your own proxy)
#   SONTOLOYO_RESUME          set to "1" to resume from the last completed step
#
# Re-running: idempotent. Each step writes a marker to /var/lib/sontoloyo-install/
# so you can re-run after fixing a problem and it skips already-completed steps.
# Pass --reset to wipe markers and start over.
# =============================================================================

set -euo pipefail

# Rich output even when piped through `sudo bash` (common on initial install).
if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_BOLD=""; C_DIM=""; C_RESET=""
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
fi

# ─── Logging helpers ──────────────────────────────────────────────────────
log()    { echo "${C_DIM}[$(date +%H:%M:%S)]${C_RESET} ${1}"; }
info()   { echo "${C_CYAN}ℹ${C_RESET}  ${1}"; }
ok()     { echo "${C_GREEN}✓${C_RESET}  ${1}"; }
warn()   { echo "${C_YELLOW}⚠${C_RESET}  ${1}" >&2; }
err()    { echo "${C_RED}✗${C_RESET}  ${1}" >&2; }
die()    { err "${1}"; exit 1; }
heading() {
  echo
  echo "${C_BOLD}${C_BLUE}═══════════════════════════════════════════════════════════════${C_RESET}"
  echo "${C_BOLD}${C_BLUE}  ${1}${C_RESET}"
  echo "${C_BOLD}${C_BLUE}═══════════════════════════════════════════════════════════════${C_RESET}"
}
pause_cf() {
  # Render a Cloudflare manual instruction block + wait for operator confirm.
  echo
  echo "${C_BOLD}${C_YELLOW}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${C_RESET}"
  echo "${C_BOLD}${C_YELLOW}┃  CLOUDFLARE — MANUAL STEP REQUIRED                             ┃${C_RESET}"
  echo "${C_BOLD}${C_YELLOW}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${C_RESET}"
  echo "$1"
  echo
  if [[ "${NON_INTERACTIVE}" == "1" ]]; then
    warn "Non-interactive mode — assuming the step above is already done."
    return 0
  fi
  read -rp "${C_BOLD}Press ENTER once you have completed the step above…${C_RESET} " _
}

# ─── Pre-flight checks ────────────────────────────────────────────────────
[[ "${EUID}" -eq 0 ]] || die "Run as root: sudo bash install-dashboard.sh"

if [[ ! -f /etc/os-release ]] || ! grep -q "Ubuntu" /etc/os-release; then
  warn "Tested only on Ubuntu 24.04. Other distros may need manual tweaks."
fi

# ─── Configurable defaults ────────────────────────────────────────────────
REPO_URL="${SONTOLOYO_REPO:-https://github.com/turmiyahwati/Agunk.git}"
INSTALL_DIR="${SONTOLOYO_INSTALL_DIR:-/root/sontoloyo-monitor}"
BRANCH="${SONTOLOYO_BRANCH:-main}"
NON_INTERACTIVE="${SONTOLOYO_NON_INTERACTIVE:-0}"
SKIP_NGINX="${SONTOLOYO_SKIP_NGINX:-0}"
STATE_DIR="/var/lib/sontoloyo-install"
LOG_FILE="/var/log/sontoloyo-install.log"

# Argument parsing.
RESET_STATE=0
for arg in "$@"; do
  case "$arg" in
    --reset)  RESET_STATE=1 ;;
    --resume) ;; # implicit — state markers are always honored
    --help|-h)
      sed -n '3,40p' "$0"
      exit 0
      ;;
  esac
done

if [[ "$RESET_STATE" == "1" ]]; then
  rm -rf "$STATE_DIR"
  ok "State directory reset."
fi

mkdir -p "$STATE_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

# ─── Step state machine ───────────────────────────────────────────────────
mark_done()  { touch "${STATE_DIR}/$1.done"; }
is_done()    { [[ -f "${STATE_DIR}/$1.done" ]]; }
step_skip()  { ok "Step '${1}' already done — skipping. (Run with --reset to redo.)"; }

# ─── Welcome banner ───────────────────────────────────────────────────────
clear || true
cat <<'BANNER'

  ╔═══════════════════════════════════════════════════════════════════╗
  ║                                                                   ║
  ║      PT Sontoloyo Monitor — Dashboard Auto Installer              ║
  ║      Pakde Xresx Digital Store · Ubuntu 24.04 LTS                 ║
  ║                                                                   ║
  ╚═══════════════════════════════════════════════════════════════════╝

BANNER
echo "${C_DIM}Logs: ${LOG_FILE}${C_RESET}"
echo "${C_DIM}State: ${STATE_DIR}${C_RESET}"
echo

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — System prep
# ═════════════════════════════════════════════════════════════════════════
heading "1/10 · System prep (apt, ufw, timezone)"
if is_done 01_system_prep; then
  step_skip "system prep"
else
  log "Updating apt repositories…"
  apt-get update -y -qq

  log "Installing baseline packages…"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl ca-certificates gnupg git build-essential sqlite3 ufw cron openssl

  log "Setting timezone to Asia/Jakarta (WIB)…"
  timedatectl set-timezone Asia/Jakarta || warn "Could not set timezone — continuing."

  if command -v ufw >/dev/null 2>&1; then
    log "Configuring UFW (allowing SSH, 80, 443)…"
    ufw allow OpenSSH >/dev/null 2>&1 || true
    ufw allow 80/tcp  >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    if ! ufw status | grep -q "Status: active"; then
      log "Enabling UFW…"
      ufw --force enable >/dev/null 2>&1 || warn "UFW enable failed — check manually."
    fi
  fi
  mark_done 01_system_prep
  ok "System prep complete."
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — Node.js 20 + PM2 + nginx
# ═════════════════════════════════════════════════════════════════════════
heading "2/10 · Runtime stack (Node 20, PM2, nginx)"
if is_done 02_runtime; then
  step_skip "runtime stack"
else
  if ! node -v 2>/dev/null | grep -q "^v20"; then
    log "Installing Node.js 20 via NodeSource…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  else
    ok "Node.js 20 already installed: $(node -v)"
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    log "Installing PM2…"
    npm install -g pm2@latest
  else
    ok "PM2 already installed: $(pm2 -v)"
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    log "Installing nginx…"
    apt-get install -y -qq nginx
    systemctl enable --now nginx
  else
    ok "nginx already installed."
  fi

  mark_done 02_runtime
  ok "Runtime stack complete."
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — Clone repository
# ═════════════════════════════════════════════════════════════════════════
heading "3/10 · Repository checkout"
if is_done 03_clone; then
  step_skip "repository checkout"
else
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    log "Existing checkout detected at ${INSTALL_DIR} — pulling latest…"
    git -C "${INSTALL_DIR}" fetch --quiet origin
    git -C "${INSTALL_DIR}" checkout --quiet "${BRANCH}"
    git -C "${INSTALL_DIR}" reset --hard --quiet "origin/${BRANCH}"
  else
    log "Cloning ${REPO_URL} (branch ${BRANCH}) → ${INSTALL_DIR}"
    git clone --quiet --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  fi
  mark_done 03_clone
  ok "Repository ready at ${INSTALL_DIR}."
fi
cd "${INSTALL_DIR}"

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — .env wizard
# ═════════════════════════════════════════════════════════════════════════
heading "4/10 · Environment configuration"
if is_done 04_env; then
  step_skip "environment configuration"
else
  if [[ -f .env ]] && grep -q "^NEXTAUTH_SECRET=" .env && \
     ! grep -q '^NEXTAUTH_SECRET="change-me' .env; then
    ok ".env already configured. Reusing it."
  else
    log "Generating fresh .env…"

    DOMAIN="${SONTOLOYO_DOMAIN:-}"
    ADMIN_EMAIL_VAL="${SONTOLOYO_ADMIN_EMAIL:-}"
    ADMIN_PASS_VAL="${SONTOLOYO_ADMIN_PASSWORD:-}"

    if [[ -z "$DOMAIN" && "$NON_INTERACTIVE" != "1" ]]; then
      while [[ -z "$DOMAIN" ]]; do
        read -rp "${C_BOLD}Dashboard public hostname${C_RESET} (e.g. monitoring.example.com): " DOMAIN
      done
    fi
    [[ -n "$DOMAIN" ]] || die "Dashboard domain is required."

    if [[ -z "$ADMIN_EMAIL_VAL" && "$NON_INTERACTIVE" != "1" ]]; then
      read -rp "${C_BOLD}Admin email${C_RESET} [admin@${DOMAIN}]: " ADMIN_EMAIL_VAL
      ADMIN_EMAIL_VAL="${ADMIN_EMAIL_VAL:-admin@${DOMAIN}}"
    fi
    ADMIN_EMAIL_VAL="${ADMIN_EMAIL_VAL:-admin@${DOMAIN}}"

    if [[ -z "$ADMIN_PASS_VAL" ]]; then
      ADMIN_PASS_VAL="$(openssl rand -base64 18 | tr -d '+/=' | cut -c1-20)"
      info "Generated admin password (will be displayed once at the end)."
    fi

    NEXTAUTH_SECRET="$(openssl rand -base64 32)"
    SYNC_TOKEN="$(openssl rand -hex 32)"

    # ─── Optional backup passphrase (R2) ──────────────────────────────
    # AES-256 encryption for nightly state backups via scripts/backup-all.sh.
    # Empty Enter is fine — the operator can set it later via Admin →
    # Backup & Recovery, and the daily cron will simply produce
    # unencrypted .tar.gz files in the meantime (with a loud warning in
    # the backup log).
    BACKUP_PASS_VAL="${SONTOLOYO_BACKUP_PASSPHRASE:-}"
    if [[ -z "$BACKUP_PASS_VAL" && "$NON_INTERACTIVE" != "1" ]]; then
      echo
      info "Optional: backup passphrase enables AES-256 encryption for nightly backups."
      info "Skip with empty Enter — you can set it later via Admin → Backup & Recovery."
      read -rp "${C_BOLD}Backup passphrase (empty = skip):${C_RESET} " BACKUP_PASS_VAL
    fi

    cat > .env <<EOF
# Auto-generated by install-dashboard.sh on $(date -Iseconds)
# Edit carefully — pm2 reload required after changes.

DATABASE_URL="file:./prod.db"

NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="https://${DOMAIN}"

ADMIN_EMAIL="${ADMIN_EMAIL_VAL}"
ADMIN_PASSWORD="${ADMIN_PASS_VAL}"
ADMIN_NAME="Super Admin"

MONITOR_SYNC_TOKEN="${SYNC_TOKEN}"
NEXT_PUBLIC_REFRESH_MS=10000
NEXT_PUBLIC_ACTIVITY_REFRESH_MS=5000
VPS_FETCH_TIMEOUT_MS=4000
VPS_FETCH_RETRIES=2

NEXT_PUBLIC_BRAND_NAME="PT Sontoloyo"
NEXT_PUBLIC_BRAND_SUFFIX="Monitor"
NEXT_PUBLIC_AUTHOR="Pakde Xresx Digital Store"
NEXT_PUBLIC_WHATSAPP_NUMBER=""
NEXT_PUBLIC_WHATSAPP_TEXT="Halo Admin, saya ingin info layanan VPN/Xray."

# Backup destination (used by scripts/backup-all.sh).
# Leave empty to keep backups local-only under /root/sontoloyo-backups/.
SONTOLOYO_BACKUP_PASSPHRASE="${BACKUP_PASS_VAL}"
EOF
    chmod 600 .env

    # Persist plain-text receipt for the operator (root-only).
    cat > /root/sontoloyo-credentials.txt <<EOF
PT Sontoloyo Monitor — generated credentials
Generated: $(date -Iseconds)

  Dashboard URL    : https://${DOMAIN}
  Admin email      : ${ADMIN_EMAIL_VAL}
  Admin password   : ${ADMIN_PASS_VAL}
  NEXTAUTH_SECRET  : ${NEXTAUTH_SECRET}
  MONITOR_SYNC_TOKEN: ${SYNC_TOKEN}

KEEP THIS FILE SAFE. Anyone with the password owns the dashboard.
After confirming you have it stored elsewhere, you may delete it:

  shred -u /root/sontoloyo-credentials.txt
EOF
    if [[ -n "${BACKUP_PASS_VAL}" ]]; then
      # Append separately so the receipt is friendly and the backup
      # passphrase is grepable (operators will need it for restore).
      cat >> /root/sontoloyo-credentials.txt <<EOF

  Backup passphrase: ${BACKUP_PASS_VAL}
  (used by scripts/backup-all.sh AES-256-CBC encryption — keep it!)
EOF
    fi
    chmod 600 /root/sontoloyo-credentials.txt
    ok "Wrote /root/sontoloyo-credentials.txt (root only, mode 600)."
  fi
  mark_done 04_env
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — Install dependencies + build + database
# ═════════════════════════════════════════════════════════════════════════
heading "5/10 · npm ci + Prisma + Next build"
if is_done 05_build; then
  step_skip "build"
else
  log "npm ci (this takes 1-2 min)…"
  npm ci --no-audit --no-fund --silent

  log "Generating Prisma client + pushing schema…"
  npx --yes prisma generate >/dev/null
  npx --yes prisma db push --skip-generate

  log "Seeding admin user…"
  npm run db:seed --silent || warn "db:seed reported a non-zero exit — usually safe (already seeded)."

  log "Building Next.js production bundle…"
  npm run build --silent

  mark_done 05_build
  ok "Build artifacts ready."
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 6 — PM2 + systemd autostart
# ═════════════════════════════════════════════════════════════════════════
heading "6/10 · PM2 process manager"
if is_done 06_pm2; then
  step_skip "PM2"
else
  if pm2 describe sontoloyo >/dev/null 2>&1; then
    log "Reloading existing PM2 process…"
    pm2 reload sontoloyo
  else
    log "Starting Next.js under PM2 as 'sontoloyo'…"
    pm2 start "npm run start" --name sontoloyo --cwd "${INSTALL_DIR}"
  fi

  pm2 save
  if ! systemctl list-unit-files | grep -q "^pm2-root.service"; then
    log "Configuring PM2 systemd autostart…"
    pm2 startup systemd -u root --hp /root | tail -1 | bash || warn "PM2 startup install failed — check manually."
  fi

  mark_done 06_pm2
  ok "PM2 + systemd configured."
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 7 — Cloudflare DNS + SSL (manual, with explicit instructions)
# ═════════════════════════════════════════════════════════════════════════
heading "7/10 · Cloudflare DNS + SSL Origin Certificate (MANUAL)"

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "<your-vps-ip>")"
DOMAIN_FROM_ENV="$(grep '^NEXTAUTH_URL=' .env | cut -d'"' -f2 | sed 's|^https\?://||')"

pause_cf "$(cat <<INSTRUCT
${C_BOLD}Step 7a — Add a DNS A record on Cloudflare:${C_RESET}

  • Cloudflare dashboard → Websites → ${C_CYAN}your domain${C_RESET} → DNS → Records
  • Click ${C_BOLD}+ Add record${C_RESET} and fill:
      Type      : ${C_GREEN}A${C_RESET}
      Name      : ${C_GREEN}$(echo "${DOMAIN_FROM_ENV}" | cut -d'.' -f1)${C_RESET}
      IPv4      : ${C_GREEN}${PUBLIC_IP}${C_RESET}    ${C_DIM}(this server's public IP)${C_RESET}
      Proxy     : ${C_GREEN}Proxied (orange cloud)${C_RESET}
      TTL       : Auto

${C_BOLD}Step 7b — Set SSL/TLS encryption mode:${C_RESET}

  • Cloudflare → SSL/TLS → Overview → ${C_GREEN}Full (strict)${C_RESET}
  • Cloudflare → SSL/TLS → Edge Certificates → enable:
      ☑ Always Use HTTPS
      ☑ Automatic HTTPS Rewrites
      Min TLS Version : ${C_GREEN}TLS 1.2${C_RESET}
INSTRUCT
)"

if is_done 07_ssl_cert; then
  step_skip "SSL certificate paste"
else
  pause_cf "$(cat <<INSTRUCT
${C_BOLD}Step 7c — Generate an Origin Certificate (15-year, free):${C_RESET}

  • Cloudflare → SSL/TLS → Origin Server → ${C_GREEN}Create Certificate${C_RESET}
  • Defaults are fine (RSA 2048, hostnames like *.your-domain + your-domain, 15 years)
  • Click ${C_BOLD}Create${C_RESET}.
  • You will see TWO blocks: ${C_BOLD}Origin Certificate${C_RESET} and ${C_BOLD}Private key${C_RESET}.
  • ${C_RED}Copy BOTH blocks${C_RESET} — Cloudflare shows the private key ONLY ONCE.
INSTRUCT
)"

  mkdir -p /etc/ssl/cloudflare

  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    if [[ ! -f /etc/ssl/cloudflare/origin.pem || ! -f /etc/ssl/cloudflare/origin.key ]]; then
      die "Non-interactive mode but /etc/ssl/cloudflare/origin.{pem,key} missing. Place them first or re-run interactively."
    fi
  else
    echo
    info "Now paste the ${C_BOLD}Origin Certificate${C_RESET} (starts with -----BEGIN CERTIFICATE-----)."
    info "End with a blank line, then press Ctrl-D."
    cat > /etc/ssl/cloudflare/origin.pem
    if ! grep -q "BEGIN CERTIFICATE" /etc/ssl/cloudflare/origin.pem; then
      rm -f /etc/ssl/cloudflare/origin.pem
      die "That did not look like a certificate. Re-run installer to retry."
    fi

    echo
    info "Now paste the ${C_BOLD}Private key${C_RESET} (starts with -----BEGIN PRIVATE KEY-----)."
    info "End with a blank line, then press Ctrl-D."
    cat > /etc/ssl/cloudflare/origin.key
    if ! grep -q "BEGIN PRIVATE KEY\|BEGIN RSA PRIVATE KEY" /etc/ssl/cloudflare/origin.key; then
      rm -f /etc/ssl/cloudflare/origin.key
      die "That did not look like a private key. Re-run installer to retry."
    fi
  fi
  chmod 600 /etc/ssl/cloudflare/origin.key
  chmod 644 /etc/ssl/cloudflare/origin.pem
  ok "SSL certificate + key stored at /etc/ssl/cloudflare/."
  mark_done 07_ssl_cert
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 8 — nginx site config
# ═════════════════════════════════════════════════════════════════════════
heading "8/10 · nginx reverse proxy"
if [[ "$SKIP_NGINX" == "1" ]]; then
  warn "SONTOLOYO_SKIP_NGINX=1 — skipping nginx config. Configure your own proxy to 127.0.0.1:3000."
elif is_done 08_nginx; then
  step_skip "nginx"
else
  TPL="${INSTALL_DIR}/scripts/templates/nginx-sontoloyo.conf.tpl"
  if [[ ! -f "$TPL" ]]; then
    die "nginx template missing: $TPL"
  fi

  log "Rendering nginx config from template…"
  sed "s|{{DOMAIN}}|${DOMAIN_FROM_ENV}|g" "$TPL" > /etc/nginx/sites-available/sontoloyo
  ln -sf /etc/nginx/sites-available/sontoloyo /etc/nginx/sites-enabled/sontoloyo
  rm -f /etc/nginx/sites-enabled/default

  log "Testing nginx config…"
  if nginx -t; then
    systemctl reload nginx
    ok "nginx reloaded."
  else
    err "nginx -t failed. Fix /etc/nginx/sites-available/sontoloyo and run 'nginx -t' manually."
    exit 1
  fi
  mark_done 08_nginx
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 9 — Cron auto-sync + nightly backup
# ═════════════════════════════════════════════════════════════════════════
# ─── Backup interval (R1) ────────────────────────────────────────────────
# Operator may pin a non-default cadence via SONTOLOYO_BACKUP_INTERVAL_HOURS.
# Accepted values: 1 / 3 / 6 / 12 / 24 hours. Anything else falls back to
# the safe default (3 h). The mapping is explicit (not a generic
# `0 */N * * *` formula) because cron interprets "*/7" as "every hour
# whose number is divisible by 7" — i.e. 00:00 and 07:00 only — which
# is rarely what an operator actually wants for a 7-hour cadence.
BACKUP_INTERVAL="${SONTOLOYO_BACKUP_INTERVAL_HOURS:-3}"
case "${BACKUP_INTERVAL}" in
  1)  BACKUP_CRON="0 *  * * *" ; BACKUP_DESC="setiap jam" ;;
  3)  BACKUP_CRON="0 */3 * * *"; BACKUP_DESC="setiap 3 jam" ;;
  6)  BACKUP_CRON="0 */6 * * *"; BACKUP_DESC="setiap 6 jam" ;;
  12) BACKUP_CRON="0 */12 * * *"; BACKUP_DESC="setiap 12 jam" ;;
  24) BACKUP_CRON="30 2 * * *" ; BACKUP_DESC="harian 02:30 WIB" ;;
  *)
    warn "Unknown SONTOLOYO_BACKUP_INTERVAL_HOURS='${BACKUP_INTERVAL}' — falling back to 3h."
    BACKUP_INTERVAL="3"
    BACKUP_CRON="0 */3 * * *"
    BACKUP_DESC="setiap 3 jam"
    ;;
esac

heading "9/10 · Cron — auto-sync + backup ${BACKUP_DESC}"
if is_done 09_cron; then
  step_skip "cron"
else
  SYNC_TOKEN_VAL="$(grep '^MONITOR_SYNC_TOKEN=' .env | cut -d'"' -f2)"
  CRON_FILE=/etc/cron.d/sontoloyo

  cat > "${CRON_FILE}" <<EOF
# PT Sontoloyo Monitor — auto-managed by install-dashboard.sh
# Auto-sync every minute (safety net; in-process autosync also runs).
* * * * * root curl -fsS --max-time 30 -H "X-Sync-Token: ${SYNC_TOKEN_VAL}" -X POST https://${DOMAIN_FROM_ENV}/api/monitor/sync >> /var/log/sontoloyo-sync.log 2>&1

# Encrypted full-state backup — schedule: ${BACKUP_DESC} (interval ${BACKUP_INTERVAL}h).
${BACKUP_CRON} root cd ${INSTALL_DIR} && /bin/bash scripts/backup-all.sh >> /var/log/sontoloyo-backup.log 2>&1
EOF
  chmod 644 "${CRON_FILE}"
  systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true

  ok "Cron installed: ${CRON_FILE}"
  mark_done 09_cron
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 10 — Smoke test
# ═════════════════════════════════════════════════════════════════════════
heading "10/10 · Smoke test"
sleep 3

LOCAL_OK=0
if curl -fsS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null | grep -q "200"; then
  ok "Next.js responds locally on :3000"
  LOCAL_OK=1
else
  warn "Next.js not responding on :3000. Check 'pm2 logs sontoloyo'."
fi

if [[ "$SKIP_NGINX" != "1" ]]; then
  if curl -fsSk -o /dev/null -w "%{http_code}" "https://127.0.0.1" -H "Host: ${DOMAIN_FROM_ENV}" 2>/dev/null | grep -qE "200|301|302"; then
    ok "nginx serves HTTPS for ${DOMAIN_FROM_ENV}"
  else
    warn "nginx HTTPS test inconclusive — verify 'curl -I https://${DOMAIN_FROM_ENV}' from outside."
  fi
fi

if pm2 describe sontoloyo | grep -q "online"; then
  ok "PM2 process 'sontoloyo' is online."
else
  warn "PM2 process not online. Run 'pm2 status' to inspect."
fi

# ═════════════════════════════════════════════════════════════════════════
# Final summary
# ═════════════════════════════════════════════════════════════════════════
echo
echo "${C_BOLD}${C_GREEN}╔═══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_BOLD}${C_GREEN}║                                                                   ║${C_RESET}"
echo "${C_BOLD}${C_GREEN}║       ✅  Installation complete                                   ║${C_RESET}"
echo "${C_BOLD}${C_GREEN}║                                                                   ║${C_RESET}"
echo "${C_BOLD}${C_GREEN}╚═══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo
echo "  ${C_BOLD}Dashboard URL${C_RESET} : https://${DOMAIN_FROM_ENV}"
echo "  ${C_BOLD}Credentials${C_RESET}   : /root/sontoloyo-credentials.txt"
echo "  ${C_BOLD}Logs${C_RESET}          : pm2 logs sontoloyo · journalctl -u nginx · ${LOG_FILE}"
echo "  ${C_BOLD}Backup cron${C_RESET}   : ${BACKUP_DESC} → /root/sontoloyo-backups/"
echo "  ${C_BOLD}Sync cron${C_RESET}     : every minute → /var/log/sontoloyo-sync.log"

# ─── Registered agent VPSes (R5) ─────────────────────────────────────────
# Surface what's already in the database so an operator re-running the
# installer (e.g. after a rollback) can see at a glance which agents are
# already wired up. Wrapped in a guard so a fresh install with no DB
# rows simply skips this section silently.
if [[ -f "${INSTALL_DIR}/prisma/prod.db" ]] && command -v sqlite3 >/dev/null 2>&1; then
  SERVER_COUNT="$(sqlite3 "${INSTALL_DIR}/prisma/prod.db" 'SELECT COUNT(*) FROM Server;' 2>/dev/null || echo 0)"
  if [[ "${SERVER_COUNT}" -gt 0 ]]; then
    echo
    echo "${C_BOLD}Registered agent VPSes (${SERVER_COUNT}):${C_RESET}"
    sqlite3 "${INSTALL_DIR}/prisma/prod.db" \
      "SELECT '  • ' || name || ' [' || status || '] ' || COALESCE(apiUrl, '<no apiUrl>') FROM Server WHERE enabled = 1;" \
      2>/dev/null || true
  fi
fi

echo
echo "${C_BOLD}${C_YELLOW}Next steps:${C_RESET}"
echo
echo "  1. ${C_CYAN}Open${C_RESET} https://${DOMAIN_FROM_ENV} in a browser"
echo "     and log in with the credentials from /root/sontoloyo-credentials.txt"
echo
echo "  2. For each VPS you want to monitor:"
echo "       a) SSH into that VPS"
echo "       b) Run the agent installer:"
echo "          ${C_DIM}git clone ${REPO_URL} /tmp/sontoloyo${C_RESET}"
echo "          ${C_DIM}cd /tmp/sontoloyo/vps-agent && bash install.sh${C_RESET}"
echo "       c) Set up Cloudflare Tunnel (manual — see DEPLOY.md §7)"
echo "       d) Add the agent in Admin → Servers"
echo
echo "  3. ${C_CYAN}Optional Cloudflare hardening${C_RESET} (manual):"
echo "       • Security → WAF → Managed Rules: ON"
echo "       • Security → Bots → Bot Fight Mode: ON"
echo "       • Speed → Optimization → Brotli + Auto Minify: ON"
echo "       • Network → HTTP/3 (QUIC): ON"
echo "       • Page Rule: 'monitoring.your-domain/api/*' → Cache Level: Bypass"
echo "       • DO NOT enable: Rocket Loader, Email Obfuscation"
echo
echo "  4. ${C_CYAN}Disaster recovery${C_RESET}:"
if [[ -n "${BACKUP_PASS_VAL:-}" ]]; then
  echo "       • Backup passphrase already set — AES-256 encryption ${C_GREEN}ON${C_RESET} (saved in credentials.txt)"
else
  echo "       • Set SONTOLOYO_BACKUP_PASSPHRASE in ${C_BOLD}.env${C_RESET} OR via Admin → Backup & Recovery to enable encryption"
fi
echo "       • Test restore: ${C_DIM}sudo bash scripts/restore.sh /root/sontoloyo-backups/<file>${C_RESET}"
echo "       • Full procedure: RECOVERY.md"
echo
echo "  5. ${C_CYAN}Email-delivered backups (optional)${C_RESET}:"
echo "       SMTP credentials are NOT written to .env — they live encrypted"
echo "       inside the dashboard's Setting table, configured via the UI:"
echo
echo "       a) Open ${C_BOLD}Admin → Backup & Recovery${C_RESET}"
echo "       b) Scroll to ${C_BOLD}Email delivery${C_RESET} → fill SMTP host/user/pass"
echo "          (Gmail App Password, not your real Gmail password)"
echo "       c) Click ${C_BOLD}Send test email${C_RESET} to verify"
echo "       d) Once verified, the backup cron (${BACKUP_DESC}) will email"
echo "          each fresh archive to the configured recipient"
echo
echo "${C_DIM}Run with --reset to wipe state markers and re-run from scratch.${C_RESET}"
echo
