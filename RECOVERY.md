# Disaster Recovery — PT Sontoloyo Monitor

> What to do when the dashboard VPS dies, gets suspended, or its state corrupts.

---

## TL;DR

1. Provision a **new** Ubuntu 24.04 VPS.
2. Run the auto-installer to bring up empty dashboard:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/turmiyahwati/Agunk/main/scripts/install-dashboard.sh | sudo bash
   ```
3. Skip Cloudflare cert paste — answer the prompts but you'll restore the cert in step 4.
4. Copy your latest backup file onto the new VPS:
   ```bash
   scp sontoloyo-backup-host-2026-XX-XX.tar.gz.enc root@NEW_VPS:/root/
   ```
5. Run the restore script:
   ```bash
   sudo bash /root/sontoloyo-monitor/scripts/restore.sh /root/sontoloyo-backup-host-2026-XX-XX.tar.gz.enc
   ```
6. Update Cloudflare DNS A record to the new VPS IP.

**Total recovery time:** ~10 minutes (5 install + 2 restore + 3 DNS propagation).

---

## What gets backed up

The `scripts/backup-all.sh` script runs nightly at 02:30 server time and produces:

```
/root/sontoloyo-backups/sontoloyo-backup-<host>-<TIMESTAMP>.tar.gz.enc
├── prod.db                     # SQLite database (after VACUUM)
├── env                          # full .env file (renamed)
├── uploads/                     # admin-uploaded logo, etc.
├── ssl/origin.pem               # Cloudflare Origin Certificate
├── ssl/origin.key               # Cloudflare Origin private key
├── nginx/sontoloyo.conf         # nginx site config
└── manifest.json                # version + SHA-256 checksums + git commit
```

Encryption: AES-256-CBC with PBKDF2 (100k iterations).
Passphrase: `SONTOLOYO_BACKUP_PASSPHRASE` from `.env`.

---

## Backup retention & off-site storage

### Local-only (default)
- Stored at `/root/sontoloyo-backups/`
- Retention: 14 days (override with `BACKUP_RETENTION_DAYS=30` in `.env`)

### Off-site (recommended for true DR)

⚠️ **A backup that lives only on the same VPS as the dashboard is no DR.**
If the VPS dies, your backups die with it.

#### Option A — Cloudflare R2 (recommended)
You're already using Cloudflare. R2 has an S3-compatible API + free egress.

1. Cloudflare dashboard → R2 → Create bucket: `sontoloyo-backup`
2. Create API token with `Object Read & Write` scope
3. Install rclone:
   ```bash
   curl -fsSL https://rclone.org/install.sh | sudo bash
   ```
4. Configure rclone (interactive):
   ```bash
   rclone config
   # storage type: s3
   # provider: Cloudflare
   # access key + secret: from R2 token
   # endpoint: https://<account-id>.r2.cloudflarestorage.com
   # name the remote "r2"
   ```
5. Test:
   ```bash
   rclone mkdir r2:sontoloyo-backup
   rclone lsd r2:
   ```
6. Tell `backup-all.sh` to push to R2 by adding to `.env`:
   ```env
   SONTOLOYO_BACKUP_REMOTE="r2:sontoloyo-backup"
   ```

The cron will now upload every nightly backup to R2 automatically.

#### Option B — rsync to a second VPS
If you have a backup VPS:

```bash
# On dashboard VPS, add to /etc/cron.d/sontoloyo:
0 3 * * * root rsync -az /root/sontoloyo-backups/ backup-vps:/srv/sontoloyo-backups/ >> /var/log/sontoloyo-rsync.log 2>&1
```

---

## Recovery scenarios

### Scenario 1 — VPS suspended, but data intact

You can recover from a VPS suspension if the provider lets you take a snapshot:

1. Ask provider to unsuspend or give you a snapshot.
2. Reboot.
3. Verify services: `pm2 status`, `nginx -t`, `systemctl status nginx`.

### Scenario 2 — VPS dead, backups intact (off-site)

The full disaster recovery path. Follow the TL;DR above.

### Scenario 3 — Database corruption

```bash
# Stop services
pm2 stop sontoloyo

# Backup the broken DB just in case
cp prisma/prod.db prisma/prod.db.broken-$(date +%s)

# Find latest backup and restore
ls -lah /root/sontoloyo-backups/
sudo bash scripts/restore.sh /root/sontoloyo-backups/<latest>.tar.gz.enc

# Verify integrity
sqlite3 prisma/prod.db "PRAGMA integrity_check;"
```

### Scenario 4 — `.env` deleted / secrets lost

If you have your `/root/sontoloyo-credentials.txt` from initial install:

1. Re-run installer with `--reset` of step 4 only:
   ```bash
   rm /var/lib/sontoloyo-install/04_env.done
   sudo bash scripts/install-dashboard.sh
   ```
2. Recreate `.env` manually using values from credentials.txt.

If you don't:
1. Generate new secrets — sessions will all invalidate, admin must log in again.
2. Existing agent API keys still work (they're in DB, not `.env`).
3. Update cron `MONITOR_SYNC_TOKEN` to match the new value.

### Scenario 5 — Domain hijack / lost

1. Buy new domain, add to Cloudflare.
2. Update `.env` `NEXTAUTH_URL` to new domain.
3. Update nginx config `server_name` (`/etc/nginx/sites-available/sontoloyo`).
4. Reissue Cloudflare Origin Certificate for new domain.
5. Update each agent's Cloudflare Tunnel hostname (`/etc/cloudflared/config.yml`).
6. Update each `Server` row in DB:
   ```bash
   sqlite3 /root/sontoloyo-monitor/prisma/prod.db
   sqlite> UPDATE Server SET apiUrl = REPLACE(apiUrl, 'old-domain.com', 'new-domain.com');
   sqlite> .quit
   ```
7. `pm2 reload sontoloyo && systemctl reload nginx`.

---

## Testing your DR plan

You should periodically prove your backups work. Annual recommendation:

1. Spin up a test VPS (any size, can be the cheapest).
2. Install the dashboard with a different domain (e.g. `monitoring-test.your-domain.com`).
3. Restore your latest production backup on the test VPS.
4. Verify:
   - Admin login works with production password
   - Server list matches production
   - At least one agent shows as ONLINE (DNS A-record points to test VPS, but agent tunnels are still production)
5. Destroy test VPS.

If any step fails, fix the gap before the real disaster.

---

## Pre-restore checklist

Before running `restore.sh`:

- [ ] Backup file is the **latest** (check `ls -lah /root/sontoloyo-backups/`)
- [ ] You have the **decryption passphrase** (or `SONTOLOYO_BACKUP_PASSPHRASE` exported)
- [ ] Cloudflare DNS A-record is updated to point to the new VPS IP (or you can update it after)
- [ ] No active admin sessions you care about (they will be invalidated by `.env` swap)
- [ ] You understand the restore overwrites: `prisma/prod.db`, `.env`, `public/uploads/`, `/etc/ssl/cloudflare/`, `/etc/nginx/sites-available/sontoloyo`

---

## What restore.sh does NOT do

- ✗ Restore agent installations (those live on per-VPS file systems; agents are stateless re-installable)
- ✗ Recreate Cloudflare DNS records (manual via Cloudflare dashboard)
- ✗ Recreate Cloudflare Tunnels (those live on the agent VPSes, not the dashboard)
- ✗ Decrypt `.env` independently — the file is restored verbatim

---

## Rollback the restore

If the restore goes sideways and you want the previous state back, every overwritten file was saved as `<name>.before-restore.<TIMESTAMP>`:

```bash
cd /root/sontoloyo-monitor
ls *.before-restore.*

# Roll back individually
mv prisma/prod.db.before-restore.20261201T030000Z prisma/prod.db
mv .env.before-restore.20261201T030000Z .env

pm2 reload sontoloyo
```

The pre-restore backup files are kept indefinitely until you delete them by hand.
