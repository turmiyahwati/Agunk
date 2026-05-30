# PT Sontoloyo Monitor — Deployment Guide (Production)

> **Stack:** Ubuntu 24.04 LTS · Node.js 20 · Next.js 14 · PM2 · nginx · Cloudflare DNS + Tunnel · SQLite/Postgres
>
> **Author:** Pakde Xresx Digital Store
>
> **Designed for:** root-only operator, single dashboard VPS, multiple VPN/Xray VPS targets, **without panel access at the VPS provider** (no manual port-opening required).

This guide is the **single source of truth** for production deployment.
It uses **Cloudflare Tunnel** for the dashboard ↔ agent link to bypass
provider-level firewalls — no port 8787 ever needs to be public.

---

## Daftar Isi

1. [Arsitektur](#1-arsitektur)
2. [Persiapan akun & domain](#2-persiapan-akun--domain)
3. [VPS dashboard — fresh Ubuntu 24.04](#3-vps-dashboard--fresh-ubuntu-2404)
4. [Clone, .env, build, PM2](#4-clone-env-build-pm2)
5. [nginx + Cloudflare SSL Full strict](#5-nginx--cloudflare-ssl-full-strict)
6. [VPS target — install agent](#6-vps-target--install-agent)
7. [Cloudflare Tunnel di VPS target](#7-cloudflare-tunnel-di-vps-target)
8. [Daftarkan server di Admin UI](#8-daftarkan-server-di-admin-ui)
9. [Cron auto-sync + auto-backup](#9-cron-auto-sync--auto-backup)
10. [Verifikasi production](#10-verifikasi-production)
11. [Maintenance: update / rollback / restore](#11-maintenance-update--rollback--restore)
12. [Troubleshooting matrix](#12-troubleshooting-matrix)

---

## 1. Arsitektur

```
                  Internet
                     │
                     │ HTTPS 443
                     ▼
              ┌──────────────┐
              │  Cloudflare  │  DNS + WAF + SSL Full strict
              └──────┬───────┘
                     │
        ┌────────────┴─────────────┐
        │                          │
  monitoring.example.com    agent-X.example.com
  (dashboard via nginx)     (Cloudflare Tunnel → agent)
        │                          │
        ▼                          ▼
┌───────────────┐          ┌─────────────────┐
│ VPS Dashboard │          │   VPS Target    │
│ Ubuntu 24.04  │  HTTPS   │  (VPN/Xray)     │
│ /root/        │ ───────► │ Debian/Ubuntu   │
│  sontoloyo-   │ fetches  │ + sontoloyo-    │
│  monitor      │ /api/    │   agent (8787)  │
│ Next.js+PM2   │ status   │ + cloudflared   │
│ nginx :443    │          │   (outbound)    │
└───────────────┘          └─────────────────┘
                            ↑
                     Tidak butuh port public
                     Outbound HTTPS ke Cloudflare
```

**Trust boundaries:**
- `NEXTAUTH_SECRET` (dashboard JWT) — di `.env` dashboard
- `MONITOR_SYNC_TOKEN` (cron auth) — di `.env` dashboard + cron
- `SONTOLOYO_API_KEY` (per VPS) — di `/etc/sontoloyo-agent.env` setiap target + DB dashboard
- AUTH_KEY seller VPN — **tidak disentuh** monitoring (script jualanmu tetap utuh)

---

## 2. Persiapan akun & domain

| Item | Yang kamu butuhkan |
|---|---|
| Domain | 1 domain di Cloudflare (mis. `pakde-premium.xyz`) |
| Cloudflare account | Free tier sufficient |
| VPS dashboard | 1× Ubuntu 24.04, RAM 1 GB, root SSH |
| VPS target(s) | 1+ VPS VPN/Xray existing, root SSH |

**Subdomain yang akan dipakai (rencanakan dulu):**
- `monitoring.<domain>` → dashboard (mis. `monitoring.pakde-premium.xyz`)
- `agent-id1.<domain>` → VPS target 1 via Cloudflare Tunnel
- `agent-sg1.<domain>` → VPS target 2 via Cloudflare Tunnel
- dst (1 subdomain per VPS target)

---

## 3. VPS dashboard — fresh Ubuntu 24.04

### 3.1. Login + update

```bash
ssh root@IP_DASHBOARD
apt update && apt upgrade -y
timedatectl set-timezone Asia/Jakarta
```

### 3.2. UFW firewall (allow SSH dulu, baru enable!)

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

### 3.3. Install Node.js 20 + tools

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git build-essential sqlite3 curl

node -v   # v20.x
npm -v    # 10.x
```

### 3.4. Install PM2 + nginx

```bash
npm install -g pm2
apt install -y nginx
systemctl enable --now nginx
```

---

## 4. Clone, .env, build, PM2

### 4.1. Clone repo

```bash
cd /root
rm -rf sontoloyo-monitor   # clean any old folder
git clone https://github.com/turmiyahwati/Agunk.git sontoloyo-monitor
cd sontoloyo-monitor
```

### 4.2. Generate secret + edit .env

```bash
echo "NEXTAUTH_SECRET    = $(openssl rand -base64 32)"
echo "MONITOR_SYNC_TOKEN = $(openssl rand -hex 32)"
echo "ADMIN_PASSWORD     = $(openssl rand -base64 18)"
```

Catat ketiganya. Lalu:

```bash
cp .env.example .env
nano .env
```

Isi minimal (production):

```env
# Prisma resolves SQLite paths RELATIVE TO schema.prisma (yaitu folder prisma/).
# Tulis "file:./prod.db" -> jadi prisma/prod.db.
# JANGAN tulis "file:./prisma/prod.db" -> akan jadi prisma/prisma/prod.db (bug).
DATABASE_URL="file:./prod.db"

NEXTAUTH_SECRET="<paste hasil openssl rand -base64 32>"
NEXTAUTH_URL="https://monitoring.pakde-premium.xyz"

ADMIN_EMAIL="admin@pakde-premium.xyz"
ADMIN_PASSWORD="<paste hasil openssl rand -base64 18>"
ADMIN_NAME="Super Admin"

MONITOR_SYNC_TOKEN="<paste hasil openssl rand -hex 32>"
NEXT_PUBLIC_REFRESH_MS=10000
VPS_FETCH_TIMEOUT_MS=4000
VPS_FETCH_RETRIES=2

NEXT_PUBLIC_BRAND_NAME="PT Sontoloyo"
NEXT_PUBLIC_BRAND_SUFFIX="Monitor"
NEXT_PUBLIC_AUTHOR="Pakde Xresx Digital Store"
NEXT_PUBLIC_WHATSAPP_NUMBER=""
```

`Ctrl+O` → Enter → `Ctrl+X`.

```bash
chmod 600 .env
```

> **Penting:** `NEXTAUTH_URL` harus `https://` dan match dengan domain final.

### 4.3. Install + build + database

```bash
npm ci
npm run setup    # = check-env + prisma generate + db push + seed
npm run build
```

Smoke test:

```bash
npm start &
sleep 4
curl -I http://127.0.0.1:3000   # HTTP/1.1 200
kill %1
```

### 4.4. Jalankan via PM2

```bash
pm2 start "npm run start" --name sontoloyo
pm2 save
pm2 startup systemd
# COPAS perintah `sudo env PATH=...` yang muncul, jalankan baris itu

pm2 status
pm2 logs sontoloyo --lines 20
```

---

## 5. nginx + Cloudflare SSL Full strict

### 5.1. Cloudflare DNS

Di **Cloudflare dashboard → DNS → Records**:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `monitoring` | IP_DASHBOARD | **Proxied** (oranye) |

Wait 30s, test:
```bash
dig monitoring.pakde-premium.xyz +short
```

### 5.2. Cloudflare SSL/TLS

- **Overview** → **Full (strict)**
- **Edge Certificates** → enable: Always Use HTTPS, Auto HTTPS Rewrites, Min TLS 1.2

### 5.3. Origin Certificate (15 tahun, gratis)

**Cloudflare → SSL/TLS → Origin Server → Create Certificate** → default RSA 2048 → Hostnames: `*.pakde-premium.xyz, pakde-premium.xyz` → Create.

⚠️ Cloudflare tampilkan private key **HANYA SEKALI** — copy dulu sebelum tutup tab.

Di VPS dashboard:

```bash
mkdir -p /etc/ssl/cloudflare
nano /etc/ssl/cloudflare/origin.pem
# paste isi "Origin Certificate" (-----BEGIN CERTIFICATE-----)

nano /etc/ssl/cloudflare/origin.key
# paste isi "Private key" (-----BEGIN PRIVATE KEY-----)

chmod 600 /etc/ssl/cloudflare/origin.key
```

### 5.4. nginx reverse proxy

```bash
cat > /etc/nginx/sites-available/sontoloyo <<'EOF'
# Hide nginx version (security)
server_tokens off;

# Trust Cloudflare edge IPs so $remote_addr = real visitor IP
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
real_ip_header CF-Connecting-IP;

# Redirect HTTP -> HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name monitoring.pakde-premium.xyz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name monitoring.pakde-premium.xyz;

    ssl_certificate     /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    client_max_body_size 5m;
    proxy_read_timeout 60s;

    # Block hidden files
    location ~ /\.(?!well-known) { deny all; access_log off; return 404; }

    # Static assets — long cache
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # API never cached
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    # Catch-all -> Next.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
EOF

# Edit hostname:
nano /etc/nginx/sites-available/sontoloyo
# Replace `monitoring.pakde-premium.xyz` dengan domain kamu (3 occurrences)

ln -sf /etc/nginx/sites-available/sontoloyo /etc/nginx/sites-enabled/sontoloyo
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### 5.5. Cloudflare extra hardening

- **Security → WAF → Managed Rules** → ON
- **Security → Bots → Bot Fight Mode** → ON
- **Speed → Optimization → Brotli + Auto Minify (HTML/CSS/JS)** → ON
- **Network → WebSockets** → ON
- **Network → HTTP/3 (QUIC)** → ON (mempercepat first byte)
- **Page Rule** untuk `monitoring.pakde-premium.xyz/api/*` → Cache Level **Bypass**
- **Page Rule** untuk `agent-*.pakde-premium.xyz/health` → Cache Level **Bypass** (live ping butuh response real-time, tidak boleh di-cache)

⚠️ **Settings yang HARUS dihindari**:

- **Speed → Optimization → Rocket Loader** = OFF (suka break Next.js hydration)
- **Speed → Optimization → Email Address Obfuscation** = OFF (mengganggu rendering JS)
- **Caching → Cache Level: Cache Everything global** = JANGAN — `/api/*` dan `/health` harus bypass

### 5.6. Test HTTPS

Buka browser → `https://monitoring.pakde-premium.xyz` → landing page muncul, gembok hijau. Login admin pakai email + password dari `.env`.

---

## 6. VPS target — install agent

> Pindah terminal — sekarang SSH ke **VPS target VPN-mu** (VPS yang sudah punya Xray + script jualan VPN, mis. yang panel jualanmu di port 5888).

### 6.1. SSH ke target

```bash
ssh root@IP_VPS_TARGET
hostname -I  # konfirmasi VPS yang benar
```

> ⚠️ **Pastikan kamu di VPS target, BUKAN dashboard.** Banyak orang stuck karena salah VPS.

### 6.2. Install agent

```bash
apt install -y git curl
rm -rf /tmp/sontoloyo
git clone https://github.com/turmiyahwati/Agunk.git /tmp/sontoloyo
cd /tmp/sontoloyo/vps-agent
bash install.sh
```

> **Update agent existing (sudah pernah install):** `install.sh` idempotent —
> aman dijalankan ulang. Akan replace `sontoloyo_agent.py`, recreate venv
> (kalau perlu), dan `systemctl restart sontoloyo-agent`. API key existing
> di `/etc/sontoloyo-agent.env` **tidak diganti** kecuali kamu set
> `SONTOLOYO_API_KEY=...` baru di env. Selalu pull repo terbaru dulu
> (`git pull` di `/tmp/sontoloyo`) sebelum re-run `install.sh` agar dapat
> fix terbaru (mis. perhitungan Xray account dari `config.json`, vnstat
> monthly, dst).

Output akhir akan tampilkan:
```
==========================================================
 PT Sontoloyo Monitor — VPS Agent installed.
 URL:     http://YOUR_VPS_IP:8787
 API key: a1b2c3d4e5f6...
==========================================================
```

**CATAT API key.** Akan dipakai di Step 7 dan 8.

### 6.3. Test agent dari localhost target

```bash
KEY=$(grep SONTOLOYO_API_KEY /etc/sontoloyo-agent.env | cut -d= -f2)
curl -s http://127.0.0.1:8787/health
echo ""
curl -s -H "X-API-Key: $KEY" http://127.0.0.1:8787/api/status | head -c 200
```

Harus muncul JSON `{"ok":true,...}`. Kalau tidak — lihat `journalctl -u sontoloyo-agent -f`.

> **Provisioning API kamu di port 5888 tetap jalan paralel.** Agent monitoring di port 8787 tidak menyentuh apapun di sana.

---

## 7. Cloudflare Tunnel di VPS target

Karena port 8787 di VPS target **tidak public** (provider firewall), kita pakai Cloudflare Tunnel — agent connects out, dashboard reaches in via Cloudflare URL.

### 7.1. Install cloudflared

```bash
# Masih di VPS target
curl -L \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### 7.2. Login Cloudflare account

```bash
cloudflared tunnel login
```

Akan muncul URL panjang. **Copy URL itu**, paste di browser laptop kamu yang sudah login Cloudflare → pilih domain (`pakde-premium.xyz`) → Authorize.

Kembali ke terminal: `You have successfully logged in.`

### 7.3. Buat tunnel + DNS record

```bash
TUNNEL_NAME="agent-id1"   # ganti per VPS target: agent-sg1, agent-jp1, dst
DOMAIN="agent-id1.pakde-premium.xyz"   # ganti dengan subdomain & domain kamu

cloudflared tunnel create "$TUNNEL_NAME"
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN"
```

Output `tunnel create` mencatat **Tunnel ID** (UUID) di `/root/.cloudflared/<UUID>.json`.

### 7.4. Konfigurasi tunnel forward ke agent

```bash
mkdir -p /etc/cloudflared

CRED_FILE=$(ls /root/.cloudflared/*.json | head -1)
TUNNEL_NAME="agent-id1"
DOMAIN="agent-id1.pakde-premium.xyz"

cat > /etc/cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_NAME}
credentials-file: ${CRED_FILE}

ingress:
  - hostname: ${DOMAIN}
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF

cat /etc/cloudflared/config.yml
```

### 7.5. Install systemd service (auto-start)

```bash
cloudflared service install
systemctl enable --now cloudflared
sleep 5
systemctl status cloudflared --no-pager | head -10
```

Harus: `Active: active (running)`. Logs:
```bash
journalctl -u cloudflared -n 20
```

### 7.6. Verifikasi tunnel publik

Dari mana saja (laptop, VPS dashboard, dst):

```bash
curl -fsS https://agent-id1.pakde-premium.xyz/health
```

Harus muncul JSON `{"ok":true,"host":"...",...}`. ✅

### 7.7. (Optional) UFW restrict 8787 ke localhost

Karena agent sekarang diakses via tunnel, port 8787 cukup `127.0.0.1`:

```bash
# di VPS target — edit env
sed -i 's/^SONTOLOYO_HOST=.*/SONTOLOYO_HOST=127.0.0.1/' /etc/sontoloyo-agent.env
systemctl restart sontoloyo-agent
ufw delete allow 8787/tcp 2>/dev/null || true
```

Sekarang agent **tidak terlihat dari internet sama sekali** — cuma reachable via Cloudflare Tunnel. Lebih aman.

---

## 8. Daftarkan server di Admin UI

Buka `https://monitoring.pakde-premium.xyz/admin/servers` → login admin.

1. Klik **+ Tambah Server**
2. Isi:
   - **Nama**: `INDO INDO 1` (bebas)
   - **Provider**: `BiznetGio` / `Vultr` / dst
   - **Domain / IP**: IP atau hostname VPS target *(disimpan privat — admin saja, tidak ekspos ke public)*
   - **Country code**: `ID`
   - **Country name**: `Indonesia`
   - **Max Slot**: `100`
   - **VPS Agent base URL**: `https://agent-id1.pakde-premium.xyz` ← **HTTPS, tanpa port, tanpa /api/status**
   - **API Key**: paste API key dari Step 6.2
   - **Public Ping Host**: `agent-id1.pakde-premium.xyz` ← **WAJIB diisi** untuk fitur browser-side LivePing & LiveSpeed pada homepage. Pakai Cloudflare Tunnel hostname yang sama dengan agent base URL **tanpa scheme & path**. **Jangan pakai IP VPS asli** — visitor akan melihat hostname ini.
3. **Simpan**
4. Klik tombol **Wifi icon** di baris itu → toast hijau "Agent reachable · synced" ✅
5. Tunggu maks 1 menit (atau klik **Sync now** di topbar admin) → status berubah jadi **ONLINE** dengan angka CPU/RAM beneran 🎉
6. Buka homepage publik di tab incognito → server card harus tampilkan **ping live (update tiap 2.5 detik)** dan **download/upload Mbps real** yang diukur langsung dari browser visitor.

**Ulangi Step 6, 7, 8 untuk tiap VPS target.** Tiap VPS dapat subdomain Cloudflare sendiri.

---

## 9. Cron auto-sync + auto-backup

> **Heads up — sejak v1.1, dashboard punya self-healing auto-sync built-in.**
> Endpoint publik (`/api/servers/public`, `/api/stats`) yang dipanggil tiap
> kali halaman dibuka akan otomatis trigger `syncAll()` di background ketika
> data lebih lama dari 60 detik. Throttled (max 1 sync setiap 30 detik) dan
> tidak menghambat respon. Bisa di-disable lewat `MONITOR_AUTOSYNC_DISABLED=1`
> di `.env`, atau di-tune lewat `MONITOR_AUTOSYNC_STALE_MS` /
> `MONITOR_AUTOSYNC_COOLDOWN_MS`.
>
> **External cron tetap direkomendasikan** sebagai safety net — auto-sync
> hanya jalan saat ada visitor yang ngebuka halaman, jadi pada hari yang
> sangat sepi traffic, data bisa stale. Kalau dashboard kamu ramai dipake
> setiap menit, cron eksternal opsional.

### 9.1. Cron sync (setiap menit) — recommended safety net

```bash
# Di VPS dashboard
crontab -e
```

Tambahkan:

```cron
* * * * * curl -fsS --max-time 30 -H "X-Sync-Token: TOKEN_KAMU" -X POST https://monitoring.pakde-premium.xyz/api/monitor/sync >> /var/log/sontoloyo-sync.log 2>&1
```

Ganti `TOKEN_KAMU` dengan **MONITOR_SYNC_TOKEN** dari `.env`. Test manual:

```bash
curl -fsS -H "X-Sync-Token: TOKEN_KAMU" -X POST https://monitoring.pakde-premium.xyz/api/monitor/sync
# → {"total":1,"ok":1,"failed":0,"success":true,"ts":"..."}
```

Cek 60 detik berikutnya:
```bash
tail -3 /var/log/sontoloyo-sync.log
```

### 9.2. Cron backup database (jam 02:30 daily)

```bash
crontab -e
```

Tambahkan:

```cron
30 2 * * * cd /root/sontoloyo-monitor && /usr/bin/node scripts/backup-db.mjs >> /var/log/sontoloyo-backup.log 2>&1
```

Test manual:
```bash
cd /root/sontoloyo-monitor
node scripts/backup-db.mjs
ls -la backups/
```

Backup auto-cleanup file lebih dari 14 hari (default `BACKUP_RETENTION_DAYS=14`).

---

## 10. Verifikasi production

Centang ini sebelum dianggap selesai:

```bash
# 1. PM2 sehat
pm2 status                                    # sontoloyo: online, restart < 5

# 2. nginx OK
nginx -t && systemctl is-active nginx        # syntax ok, active

# 3. Dashboard reachable via domain (Cloudflare)
curl -I https://monitoring.pakde-premium.xyz # HTTP/2 200

# 4. Agent reachable via tunnel
curl -fsS https://agent-id1.pakde-premium.xyz/health   # {"ok":true,...}

# 5. Cron sync running
tail -1 /var/log/sontoloyo-sync.log          # {"total":N,"ok":N,...,"success":true}

# 6. Database integrity
sqlite3 /root/sontoloyo-monitor/prisma/prod.db "PRAGMA integrity_check;"
# → ok
```

Browser checks:
- [ ] Public homepage load (no IP/domain VPS target visible)
- [ ] Login admin sukses pakai password `.env`
- [ ] Admin → Servers menampilkan IP/domain (admin-only)
- [ ] Server card status **ONLINE** dengan CPU/RAM real
- [ ] Mobile responsive (test di HP)

---

## 11. Maintenance: update / rollback / restore

### 11.1. Update dari GitHub

```bash
cd /root/sontoloyo-monitor

# Backup dulu
node scripts/backup-db.mjs

# Pull + rebuild
git fetch origin
git status                              # confirm clean
git pull origin main
npm ci
npm run build
npx prisma db push                      # idempotent

# Reload (zero-downtime)
pm2 reload sontoloyo
pm2 logs sontoloyo --lines 20

# Verify
curl -I https://monitoring.pakde-premium.xyz
```

### 11.2. Rollback kalau update gagal

```bash
cd /root/sontoloyo-monitor
git log --oneline -5                    # cari commit lama yang sehat
git reset --hard <COMMIT_HASH_LAMA>
npm ci && npm run build
pm2 reload sontoloyo
```

### 11.3. Restore database

```bash
cd /root/sontoloyo-monitor
ls backups/                             # cari snapshot terbaru
pm2 stop sontoloyo
cp prisma/prod.db prisma/prod.db.broken # save broken state
cp backups/db-2026-05-29T02-30-00.db prisma/prod.db
pm2 start sontoloyo
sqlite3 prisma/prod.db "PRAGMA integrity_check;"  # ok
```

---

## 12. Troubleshooting matrix

| Gejala | Penyebab paling mungkin | Cara fix |
|---|---|---|
| `502 Bad Gateway` di domain dashboard | PM2 mati / port 3000 tidak listen | `pm2 status`; `pm2 restart sontoloyo`; `pm2 logs sontoloyo` |
| `521/525 Cloudflare error` | nginx mati atau cert origin tidak match | `nginx -t`; cek `/etc/ssl/cloudflare/*.pem` |
| Server status OFFLINE walau agent jalan | Belum setup Cloudflare Tunnel atau apiUrl salah | Step 7 + Step 8 — pastikan apiUrl pakai `https://agent-X.domain.com` |
| Server OFFLINE: `lastError: Timeout 4000ms` | Tunnel mati atau cloudflared tidak running | `systemctl status cloudflared`; `journalctl -u cloudflared -f` |
| Server OFFLINE: `lastError: HTTP 401` | API key salah | Cek `/etc/sontoloyo-agent.env` di target = API key di Admin UI |
| Server OFFLINE: `lastError: HTTP 404` | apiUrl ada `/api/status` di akhir, harus base saja | Edit di Admin UI: `https://agent-X.domain.com` (no path) |
| Server OFFLINE: `lastError: Connection refused` | Agent tidak jalan di VPS target | `systemctl status sontoloyo-agent`; restart |
| Login gagal "JWT decryption failed" | `NEXTAUTH_SECRET` baru diganti tapi cookie lama | `pm2 reload sontoloyo`; clear cookie browser |
| `total_ssh`/`total_xray` selalu 0 | Path DB Premium installer berbeda | SSH: cek `ls /etc/ssh/.ssh.db`. Xray sekarang dihitung dari `/usr/local/etc/xray/config.json` atau `/etc/xray/config.json` (count `"email"`). Kalau Xray service mati, agent return 0 (sesuai panel). |
| Active User dashboard ≠ panel installer | Agent versi lama (pre-v1.1) menghitung `/etc/xray/.userall.db` sebagai akun aktif | Update agent: `cd /tmp/sontoloyo && git pull && cd vps-agent && bash install.sh`. v1.1+ skip file log itu dan baca `config.json` langsung. |
| Speed selalu kosong/"—" walau VPN aktif | Agent versi lama (pre-v1.1) truncate Mbps ke int | Update agent (sama seperti baris di atas). v1.1+ kirim float (mis. `0.4 Mb`). |
| Chart user aktif tidak bergerak | Tidak ada cron + visitor traffic sangat sedikit | Setup cron Section 9.1 sebagai safety net, ATAU buka dashboard 1× setiap menit (auto-sync built-in akan jalan). |
| Cron 401 | `MONITOR_SYNC_TOKEN` di .env ≠ header `X-Sync-Token` di crontab | Sinkronkan; `pm2 reload sontoloyo` setelah ubah .env |
| Tunnel tidak konek dari Cloudflare | DNS belum propagasi atau config.yml typo | `cloudflared tunnel info <name>`; `nslookup agent-X.domain.com` |
| `cloudflared: command not found` | Step 7.1 belum selesai | Re-run install command di 7.1 |

---

## 13. Bandwidth & Cost Estimation

Penting untuk operator menyiapkan kapasitas VPS sebelum traffic ramai.
Sejak v1.3 fitur browser-side speedtest dihapus — speed di card sekarang
diambil langsung dari throughput RX/TX VPS realtime, jauh lebih hemat
bandwidth dibanding versi sebelumnya.

### Per-aktivitas (diukur real)

| Aktivitas | Ukuran tiap call | Frekuensi |
|---|---|---|
| Homepage page load (cold) | ~500 KB | 1× per visitor session |
| Homepage page load (cached) | ~50 KB | repeat visit |
| Polling `/api/servers/public` | ~5 KB | tiap 10 detik selama tab aktif |
| Polling `/api/stats` | ~1 KB | tiap 10 detik selama tab aktif |
| **LivePing** ke agent `/health` | ~200 bytes (req+res) | tiap 2.5 detik selama tab aktif |
| Sync agent → DB (auto-sync) | ~3 KB (request+response) | tiap 30-60 detik per server |

### Skenario realistis (asumsi 5 menit / visitor, scroll 3 server)

#### Kecil — 200 visitor/hari, 2 server

| Komponen | Bandwidth/hari |
|---|---|
| VPS Dashboard (semua traffic visitor) | ~145 MB |
| VPS Agent per server (sync + ping) | ~5 MB |
| **Total (2 server)** | **~155 MB/hari = ~5 GB/bulan** |

#### Menengah — 2,000 visitor/hari, 5 server

| Komponen | Bandwidth/hari |
|---|---|
| VPS Dashboard | ~1.4 GB |
| VPS Agent per server | ~50 MB |
| **Total (5 server)** | **~1.7 GB/hari = ~50 GB/bulan** |

#### Besar — 10,000 visitor/hari, 10 server

| Komponen | Bandwidth/hari |
|---|---|
| VPS Dashboard | ~7 GB |
| VPS Agent per server | ~250 MB |
| **Total (10 server)** | **~9.5 GB/hari = ~285 GB/bulan** |

### Mengapa bandwidth turun drastis?

Versi sebelumnya (v1.2) menjalankan `LiveSpeed` browser-side speedtest
yang transfer 2 MB download + 1 MB upload per visitor per server card.
Untuk skenario menengah itu memakan **~10 GB/hari**. Sekarang tidak
ada speedtest sama sekali — speed ditampilkan langsung dari throughput
RX/TX server-side yang sudah otomatis di-sync.

### Tuning lain yang masih relevan

```env
# di .env dashboard — interval polling frontend (default 10s)
NEXT_PUBLIC_REFRESH_MS=10000
```

```env
# di /etc/sontoloyo-agent.env — CORS untuk /health (LivePing)
SONTOLOYO_CORS_ORIGINS=https://monitor.example.com
```

### Monitor bandwidth aktual setelah deploy

```bash
# di VPS dashboard / agent
vnstat -d                                # daily breakdown per interface
vnstat -m                                # monthly total

# realtime (paling jelas)
nethogs eth0
```

---

## Lampiran A — Migrasi dari deployment lama

Kalau kamu pernah deploy versi lama (tanpa Cloudflare Tunnel) dan agent gagal terhubung:

```bash
# Di VPS dashboard
cd /root/sontoloyo-monitor
sqlite3 prisma/prod.db "SELECT id, name, apiUrl, status, lastError FROM Server;"
```

Kalau ada server lama dengan `apiUrl: http://IP:8787` yang tidak reachable (provider firewall), update via Admin UI:

1. Buka `/admin/servers` → Edit server tsb
2. Ganti **apiUrl** dari `http://IP:8787` → `https://agent-X.domain.com`
3. **Save** → klik Wifi icon → harus "Agent reachable · synced"

Setelah migrasi, kamu boleh tutup port 8787 di UFW VPS target (Step 7.7).

---

## Lampiran B — Apa yang TIDAK disentuh deployment ini

- ✅ Script VPN/Xray existing (autoscript, installer Vladiyot, Apik, dll)
- ✅ Konfigurasi Xray (`/usr/local/etc/xray/config.json`)
- ✅ Provisioning/seller API di port **5888** (tetap jalan paralel)
- ✅ Database akun VPN — agent **read-only**:
  - SSH: `/etc/ssh/.ssh.db` (count, parse expiry)
  - Xray: `/usr/local/etc/xray/config.json` (count `"email"` entries)
  - File log lawas `/etc/xray/.userall.db` **tidak dibaca** karena
    sering berisi entri ghost (akun lama yang sudah dihapus dari panel
    masih jejaknya di file log).
- ✅ HAProxy/nginx config existing di VPS target
- ✅ AUTH_KEY seller (terpisah dari `SONTOLOYO_API_KEY`)

---

> Dokumen ini single source of truth untuk deployment.
> Update terakhir: branding **PT Sontoloyo Monitor** by **Pakde Xresx Digital Store**.
