# PT SONTOLOYO Monitor — Full Production Deployment Guide

> **For:** root-only beginner setup, fresh Ubuntu/Debian VPS.
> **Goal:** dari nol sampai dashboard live di domain dengan HTTPS + monitoring realtime.
> **Developed by:** PAKDE XRESX DIGITAL STORE.

---

## Daftar isi

1. [Arsitektur singkat](#0-arsitektur-singkat)
2. [STEP 1 — Siapkan VPS dashboard fresh](#step-1--siapkan-vps-dashboard-fresh)
3. [STEP 2 — Install Node.js 20 + tools](#step-2--install-nodejs-20--tools)
4. [STEP 3 — Clone project + setup .env](#step-3--clone-project--setup-env)
5. [STEP 4 — Build + database](#step-4--build--database)
6. [STEP 5 — Jalankan dengan PM2](#step-5--jalankan-dengan-pm2)
7. [STEP 6 — Pasang nginx reverse proxy](#step-6--pasang-nginx-reverse-proxy)
8. [STEP 7 — Domain + Cloudflare SSL Full strict](#step-7--domain--cloudflare-ssl-full-strict)
9. [STEP 8 — Cron auto-sync realtime](#step-8--cron-auto-sync-realtime)
10. [STEP 9 — Deploy agent ke VPS target](#step-9--deploy-agent-ke-vps-target)
11. [STEP 10 — Hubungkan VPS target ke dashboard](#step-10--hubungkan-vps-target-ke-dashboard)
12. [STEP 11 — Security hardening basic](#step-11--security-hardening-basic)
13. [STEP 12 — Auto-backup database harian](#step-12--auto-backup-database-harian)
14. [STEP 13 — Optimasi performa mobile + VPS spek standar](#step-13--optimasi-performa-mobile--vps-spek-standar)
15. [Maintenance: update dari GitHub](#maintenance-update-dari-github)
16. [Maintenance: rollback jika update gagal](#maintenance-rollback-jika-update-gagal)
17. [Maintenance: restore database](#maintenance-restore-database)
18. [Troubleshooting umum](#troubleshooting-umum)

---

## 0. Arsitektur singkat

```
                      ┌──────────── Cloudflare ────────────┐
                      │  DNS + WAF + SSL Full strict       │
                      └──────────────┬─────────────────────┘
                                     │ 443 (TLS)
                              ┌──────▼──────┐
                              │   nginx     │  reverse proxy
                              │             │  rate limit + headers
                              └──────┬──────┘
                                     │ 127.0.0.1:3000
                              ┌──────▼──────┐
                              │  Next.js    │  PM2 (root)
                              │ ptsontoloyo │  /root/ptsontoloyo-monitor
                              │  -monitor   │
                              └──────┬──────┘
                                     │ poll tiap menit (cron)
                                     ▼
                       ┌─────────────┬─────────────┐
                       │             │             │
                  ┌────▼────┐  ┌─────▼───┐   ┌─────▼───┐
                  │  VPS A  │  │  VPS B  │   │  VPS C  │   ← agent :8787
                  │  agent  │  │  agent  │   │  agent  │     (read-only)
                  └─────────┘  └─────────┘   └─────────┘
                  port 5888 = provisioning API (TIDAK disentuh)
```

**Branding:** semua proses, log, service, backup ber-prefix `ptsontoloyo-*`.

---

## STEP 1 — Siapkan VPS dashboard fresh

### 1.1. Login pertama kali

Dari laptop kamu:

```bash
ssh root@IP_VPS_DASHBOARD
```

> **Kenapa root?** Untuk setup awal yang simple. Maintenance solo, 1 server, bukan tim. Kalau nanti tim membesar, baru pertimbangkan user terpisah.

### 1.2. Update sistem

```bash
apt update && apt upgrade -y
```

**Fungsi:** sinkronisasi daftar paket (`update`) lalu pasang patch keamanan terbaru (`upgrade`).

**Output normal:** baris terakhir muncul `0 newly installed, 0 to remove, 0 not upgraded.` (kalau sistem sudah up-to-date).

**Error umum:** `Unable to fetch ...` → DNS/network bermasalah. Cek `ping 8.8.8.8`. Kalau kamu pakai Cloudflare DNS-over-HTTPS belum aktif di VPS, tetap bisa via DNS biasa — abaikan.

### 1.3. Set timezone (opsional tapi disarankan)

```bash
timedatectl set-timezone Asia/Jakarta
date
```

**Kenapa:** log dan backup pakai timestamp lokal, bukan UTC. Ganti `Asia/Jakarta` dengan zonamu kalau perlu.

### 1.4. Install firewall ufw + buka SSH

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

**Kenapa berurutan begini?** Kalau `ufw enable` sebelum allow SSH, kamu bisa terkunci (kicked out!). Selalu allow SSH dulu.

**Output normal:** `Status: active` + 3 rules (`22/tcp`, `80/tcp`, `443/tcp`).

---

## STEP 2 — Install Node.js 20 + tools

### 2.1. Tambahkan repo NodeSource (Node 20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
```

**Fungsi:** menambah repository resmi NodeSource untuk versi Node terbaru. Tanpa ini, Ubuntu cuma punya Node lama.

### 2.2. Install Node + Git + tools dasar

```bash
apt install -y nodejs git build-essential sqlite3 curl
```

| Paket | Fungsi |
|---|---|
| `nodejs` | runtime Next.js |
| `git` | clone + pull dari GitHub |
| `build-essential` | compile native modules (bcrypt, dll) |
| `sqlite3` | CLI untuk query database |
| `curl` | HTTP client untuk testing |

### 2.3. Verifikasi

```bash
node -v       # harus v20.x.x
npm -v        # harus 10.x.x
git --version # 2.x
```

**Output normal:** semua perintah keluarkan versi tanpa error.

**Error umum:** `node: command not found` → Step 2.1 gagal. Cek output `curl ...` apakah mengeluarkan error.

---

## STEP 3 — Clone project + setup .env

### 3.1. Pastikan folder bersih

```bash
cd /root
ls -d ptsontoloyo-monitor 2>/dev/null && rm -rf ptsontoloyo-monitor
ls -d Agunk 2>/dev/null && rm -rf Agunk
```

**Kenapa:** kita install **fresh**, jadi folder bekas (kalau ada) dibuang dulu.

### 3.2. Clone repo

```bash
git clone https://github.com/turmiyahwati/Agunk.git ptsontoloyo-monitor
cd ptsontoloyo-monitor
```

**Catatan branding:** repository GitHub-nya tetap bernama `Agunk` (legacy), tapi folder lokal di VPS ber-nama **ptsontoloyo-monitor** sesuai branding production.

### 3.3. Generate 3 secret

Sebelum edit .env, generate dulu 3 nilai random:

```bash
echo "NEXTAUTH_SECRET   = $(openssl rand -base64 32)"
echo "MONITOR_SYNC_TOKEN= $(openssl rand -hex 32)"
echo "ADMIN_PASSWORD    = $(openssl rand -base64 18)"
```

**Catat ketiganya** di notepad. Akan dipakai di .env.

### 3.4. Edit .env

```bash
cp .env.example .env
nano .env
```

Isi minimal:

```env
DATABASE_URL="file:./prod.db"

NEXTAUTH_SECRET="<paste hasil openssl rand -base64 32>"
NEXTAUTH_URL="https://your-domain.com"

ADMIN_EMAIL="admin@ptsontoloyo.com"
ADMIN_PASSWORD="<paste hasil openssl rand -base64 18>"
ADMIN_NAME="Super Admin"

MONITOR_SYNC_TOKEN="<paste hasil openssl rand -hex 32>"

NEXT_PUBLIC_REFRESH_MS=10000
VPS_FETCH_TIMEOUT_MS=4000
VPS_FETCH_RETRIES=2
```

**Save:** `Ctrl+O` → `Enter` → `Ctrl+X`.

**Penting:**
- `NEXTAUTH_URL` HARUS pakai HTTPS dan domain final kamu. Salah set → login error "JWT decryption failed".
- File `.env` jangan pernah commit ke Git (sudah di-`.gitignore`).

### 3.5. Lock permission .env (hidden env)

```bash
chmod 600 /root/ptsontoloyo-monitor/.env
ls -la /root/ptsontoloyo-monitor/.env
# -rw------- 1 root root ...
```

**Fungsi:** hanya `root` yang bisa baca/tulis. Proses lain tidak bisa intip.

---

## STEP 4 — Build + database

### 4.1. Install dependencies

```bash
cd /root/ptsontoloyo-monitor
npm ci
```

**Fungsi:** install dependency tepat seperti `package-lock.json` — deterministic, tidak ada surprise versi.

**Estimasi waktu:** 1–2 menit. **Tidak masalah** kalau ada warning "deprecated".

**Error umum:** `gyp ERR! ...` saat build native module → `apt install -y python3-dev` lalu ulang `npm ci`.

### 4.2. Build production

```bash
npm run build
```

**Fungsi:** menjalankan `prisma generate` + `next build` — generate Prisma client lalu compile Next.js production bundle.

**Estimasi:** 1–3 menit di VPS spek standar. **Yang penting:** tidak ada error merah.

### 4.3. Setup database

```bash
npx prisma db push
npm run db:seed
```

| Perintah | Fungsi |
|---|---|
| `prisma db push` | Bikin file `prod.db` dengan semua tabel sesuai schema |
| `db:seed` | Insert user admin pertama dari `ADMIN_EMAIL`/`ADMIN_PASSWORD` di .env |

**Output normal:** "Seed complete." + email admin.

### 4.4. Smoke test sebelum PM2

```bash
npm start &
sleep 5
curl -I http://127.0.0.1:3000
kill %1
```

**Output:** `HTTP/1.1 200 OK` → OK. `Cannot GET /` artinya port di-bind tapi route bermasalah → cek `npm run build`.

---

## STEP 5 — Jalankan dengan PM2

### 5.1. Install PM2 global

```bash
npm install -g pm2
```

**Fungsi:** PM2 = process manager Node.js. Bikin app jalan terus, auto-restart saat crash, auto-start saat reboot.

### 5.2. Start app via ecosystem file

```bash
cd /root/ptsontoloyo-monitor
pm2 start ecosystem.config.js
```

**Output normal:** tabel berisi `ptsontoloyo-monitor | online | 0% cpu | ...`.

### 5.3. Save state + auto-start saat reboot

```bash
pm2 save
pm2 startup systemd
```

**Output `pm2 startup`:** akan mencetak satu baris perintah panjang yang dimulai dengan `sudo env PATH=...`. **COPAS dan jalankan baris itu apa adanya.** Setelah dijalankan, PM2 akan auto-launch saat VPS reboot.

### 5.4. Verifikasi

```bash
pm2 status
pm2 logs ptsontoloyo-monitor --lines 30
curl -I http://127.0.0.1:3000
```

`Ctrl+C` untuk keluar dari logs.

**Sehat kalau:**
- `pm2 status` → `online`, restart count rendah (< 3)
- log ada baris `Ready on http://localhost:3000`
- `curl` keluar `200`

---

## STEP 6 — Pasang nginx reverse proxy

### 6.1. Install nginx

```bash
apt install -y nginx
systemctl enable --now nginx
```

### 6.2. Tambah rate-limit zones di nginx.conf

```bash
nano /etc/nginx/nginx.conf
```

Cari blok `http {` (sekitar baris 30), **TAMBAHKAN** dua baris ini di dalamnya, di awal (sebelum baris `include`):

```nginx
http {
    server_tokens off;
    limit_req_zone $binary_remote_addr zone=ptsontoloyo_general:10m rate=30r/s;
    limit_req_zone $binary_remote_addr zone=ptsontoloyo_login:10m   rate=5r/m;
    # ... existing lines ...
}
```

| Direktif | Fungsi |
|---|---|
| `server_tokens off` | sembunyikan versi nginx (security) |
| `ptsontoloyo_general` zone | 30 request/detik per IP — proteksi DDoS ringan |
| `ptsontoloyo_login` zone | 5 request/menit per IP — anti brute-force `/api/auth/*` |

Save: `Ctrl+O` → `Enter` → `Ctrl+X`.

### 6.3. Pasang virtual host

```bash
cp /root/ptsontoloyo-monitor/deploy/nginx.conf.example \
   /etc/nginx/sites-available/ptsontoloyo-monitor

nano /etc/nginx/sites-available/ptsontoloyo-monitor
```

Di editor:
1. `Ctrl+\` → ketik `your-domain.com` → `Enter` → ganti dengan domainmu (misal `monitor.ptsontoloyo.com`) → tekan `A` (replace all).
2. Untuk sementara (sambil nunggu cert), **comment-out** dua baris ini:
   ```nginx
   # ssl_certificate     /etc/ssl/cloudflare/your-domain.pem;
   # ssl_certificate_key /etc/ssl/cloudflare/your-domain.key;
   ```
3. Ubah satu baris: `listen 443 ssl http2;` → `listen 80;`. Hapus blok server `listen 80; ... return 301;` di atas (untuk sementara).

Aktifkan:

```bash
ln -sf /etc/nginx/sites-available/ptsontoloyo-monitor \
       /etc/nginx/sites-enabled/ptsontoloyo-monitor
rm -f /etc/nginx/sites-enabled/default
nginx -t
```

**Output `nginx -t` yang sehat:**
```
nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Reload:

```bash
systemctl reload nginx
curl -I http://IP_VPS                      # 200
curl -I http://IP_VPS/api/servers/public   # 401 (butuh login — ini benar)
```

---

## STEP 7 — Domain + Cloudflare SSL Full strict

### 7.1. Tambah DNS record di Cloudflare

1. Login Cloudflare → pilih domainmu
2. **DNS → Records → Add record:**
   - Type: `A`
   - Name: `monitor` (atau apa pun, jadi `monitor.ptsontoloyo.com`)
   - IPv4: IP VPS dashboard
   - Proxy: **Proxied (awan oranye)**
3. Save → tunggu 30 detik → test:
   ```bash
   nslookup monitor.your-domain.com
   ```

### 7.2. SSL/TLS mode

Tab **SSL/TLS → Overview** → pilih **Full (strict)**.

Tab **SSL/TLS → Edge Certificates** → enable:
- Always Use HTTPS
- Automatic HTTPS Rewrites
- Minimum TLS Version: **TLS 1.2**
- TLS 1.3: ON

### 7.3. Buat Origin Certificate (15 tahun)

Tab **SSL/TLS → Origin Server → Create Certificate**:
- Default RSA 2048
- Hostnames: `*.your-domain.com, your-domain.com`
- Validity: 15 years
- **Click Create**

Cloudflare hanya kasih lihat **private key 1x**. Jangan tutup tab.

### 7.4. Pasang cert di VPS

```bash
mkdir -p /etc/ssl/cloudflare

nano /etc/ssl/cloudflare/your-domain.pem
# paste ISI "Origin Certificate" (yang -----BEGIN CERTIFICATE-----)

nano /etc/ssl/cloudflare/your-domain.key
# paste ISI "Private key" (yang -----BEGIN PRIVATE KEY-----)

chmod 600 /etc/ssl/cloudflare/your-domain.key
ls -la /etc/ssl/cloudflare/
```

### 7.5. Aktifkan kembali HTTPS di nginx

```bash
nano /etc/nginx/sites-available/ptsontoloyo-monitor
```

- Uncomment 2 baris `ssl_certificate` dan ganti path-nya ke `/etc/ssl/cloudflare/your-domain.pem` dan `.key`.
- Ganti balik `listen 80;` → `listen 443 ssl http2;`.
- Tambah lagi blok HTTP redirect di atas (yang tadi dihapus):
  ```nginx
  server {
      listen 80;
      listen [::]:80;
      server_name your-domain.com;
      return 301 https://$host$request_uri;
  }
  ```

```bash
nginx -t && systemctl reload nginx
```

### 7.6. Verifikasi

Buka di browser: `https://monitor.your-domain.com`

- ✅ Gembok hijau muncul
- ✅ Landing page PT SONTOLOYO Monitor terbuka
- ✅ Footer menampilkan "by PAKDE XRESX DIGITAL STORE"

Login admin pakai email + password dari `.env`. Berhasil? Lanjut.

**Error umum:**
- **525 Cloudflare error** → SSL mode salah, atau cert tidak match. Cek `/etc/ssl/cloudflare/*.pem` benar isinya.
- **521 Web server is down** → nginx tidak listen 443, atau ufw belum allow 443. Cek `ufw status`.
- **ERR_TOO_MANY_REDIRECTS** → SSL mode "Flexible" → **harus Full strict**.

---

## STEP 8 — Cron auto-sync realtime

### 8.1. Pasang file cron

```bash
cp /root/ptsontoloyo-monitor/deploy/ptsontoloyo-sync.cron \
   /etc/cron.d/ptsontoloyo-sync

nano /etc/cron.d/ptsontoloyo-sync
```

- Ganti `YOUR_TOKEN` → nilai `MONITOR_SYNC_TOKEN` dari `.env`.
- Ganti `your-domain.com` → domain final kamu.

```bash
chmod 644 /etc/cron.d/ptsontoloyo-sync
systemctl restart cron
```

### 8.2. Tes manual

```bash
curl -fsS -H "X-Sync-Token: TOKEN_KAMU" \
  -X POST https://monitor.your-domain.com/api/monitor/sync
```

**Response normal:** `{"total":0,"ok":0,"failed":0,"success":true,...}` (total=0 wajar karena belum ada server target — lanjut step 9).

**Error:**
- `401` → `MONITOR_SYNC_TOKEN` di .env tidak match dengan header. Cek dua-duanya.
- `502` → nginx/PM2 ada yang mati. Cek `pm2 status` + `nginx -t`.

### 8.3. Verifikasi cron jalan otomatis

Tunggu 60 detik, lalu:

```bash
tail -5 /var/log/ptsontoloyo-sync.log
```

Setiap menit harus muncul satu baris JSON `{"total":...,"success":true}`.

---

## STEP 9 — Deploy agent ke VPS target

> **Pindah terminal** — sekarang SSH ke VPS VPN target (bukan dashboard!).

### 9.1. SSH ke VPS target

```bash
ssh root@IP_VPS_TARGET
```

Cek service VPN existing **masih jalan** (jangan disentuh):

```bash
systemctl is-active xray ssh nginx
# semuanya HARUS active
```

### 9.2. Clone repo + install agent

```bash
apt install -y git
git clone https://github.com/turmiyahwati/Agunk.git /tmp/agunk
cd /tmp/agunk/vps-agent
bash install.sh
```

**Yang dilakukan installer:**
1. Install python3-venv, vnstat, ping, curl
2. Copy agent ke `/opt/ptsontoloyo-agent`
3. Generate API key random
4. Bikin systemd service `ptsontoloyo-agent`
5. Open port 8787 di ufw (kalau ada)
6. Auto-cleanup install lama (kalau pernah pakai branding agunk)

**Output akhir:** menampilkan **API key** seperti `API key: a1b2c3d4...`. **Copy dan simpan baik-baik.**

Lupa? Ambil ulang:
```bash
cat /etc/ptsontoloyo-agent.env | grep MONITOR_API_KEY
```

### 9.3. Test dari dalam VPS target

```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: API_KEY_KAMU" http://127.0.0.1:8787/api/status
```

**Respon sehat:** JSON dengan `cpu`, `ram`, `total_ssh`, `total_xray`, `ssh:true`, dst.

### 9.4. (Opsional, paling aman) Restrict firewall ke IP dashboard

```bash
ufw allow from IP_VPS_DASHBOARD to any port 8787 proto tcp
ufw deny 8787/tcp
```

**Kenapa:** kalau public bisa scan port 8787, mereka bisa uji-coba API key. Restrict ke IP dashboard = serangan dari luar mati total.

### 9.5. Test dari VPS dashboard

> Pindah balik ke terminal VPS dashboard.

```bash
curl -H "X-API-Key: API_KEY_TARGET" http://IP_VPS_TARGET:8787/api/status
```

Kalau timeout/connection-refused: firewall provider (DigitalOcean/Vultr punya firewall di luar VPS) kemungkinan block. Buka port 8787 di panel provider, atau pakai allow specific IP (Step 9.4).

**Ulangi 9.1–9.5 untuk tiap VPS target.**

---

## STEP 10 — Hubungkan VPS target ke dashboard

1. Login dashboard `https://monitor.your-domain.com/login` pakai admin
2. Sidebar → **Admin → Servers → Tambah Server**
3. Isi:
   - **Name**: bebas (mis. `SG-Premium-01`)
   - **Provider**: Vultr / DigitalOcean / dst
   - **Country**: SG / ID / JP / US
   - **Domain or IP**: IP atau hostname VPS target *(disimpan di DB, hanya admin yang bisa lihat — tidak diekspos ke public)*
   - **VPS Agent base URL**: `http://IP_VPS_TARGET:8787`
   - **API Key**: paste API key dari Step 9.2
   - **Max Slot**: kapasitas user (mis. `100`)
   - **Protocol**: pilih sesuai server
4. **Save**
5. Klik **ikon Wifi** di baris server → muncul "Connection OK ✓"
6. Tunggu maks 1 menit → status berubah jadi **ONLINE** dengan angka beneran

**Verifikasi visibility:**
- Buka `/dashboard` (tab incognito, login sebagai member): kartu server muncul tapi **tanpa IP/domain** — hanya nama, country, slot, status.
- Buka `/admin/servers`: admin lihat IP/domain lengkap.

Ini sesuai requirement: public hanya nama, admin bisa detail.

---

## STEP 11 — Security hardening basic

Banyak ini sudah aktif by default; bagian ini memverifikasi + menyalakan yang belum.

### 11.1. ✅ Stack trace mati di production

Sudah aktif otomatis: `npm run build` set `NODE_ENV=production`. Next.js tidak akan tampilkan stack trace ke user.

Verifikasi: buka `https://monitor.your-domain.com/api/this-doesnt-exist` → harus 404 generic, bukan stack trace.

### 11.2. ✅ Rate limit + brute force protection

Sudah dipasang di Step 6.2. Verifikasi:

```bash
# spam 30x dalam 5 detik (general rate limit)
for i in {1..30}; do curl -s -o /dev/null -w "%{http_code}\n" \
  https://monitor.your-domain.com/; done
# beberapa terakhir akan keluar 503 — itu rate-limit kerja
```

### 11.3. ✅ Hidden env (.env permission 600)

Sudah dilakukan di Step 3.5. Verifikasi:
```bash
stat -c "%a %n" /root/ptsontoloyo-monitor/.env
# 600 /root/ptsontoloyo-monitor/.env
```

### 11.4. ✅ Hide nginx version

Sudah dilakukan di Step 6.2 (`server_tokens off`). Verifikasi:
```bash
curl -sI https://monitor.your-domain.com | grep -i server
# Server: cloudflare  ← bukan "nginx/1.x"
```

### 11.5. ✅ Public route tidak expose IP/domain

Sudah dilakukan di code. Verifikasi:
```bash
# login dulu via browser, ambil cookie session, atau pakai admin
curl -sH "Cookie: next-auth.session-token=..." \
  https://monitor.your-domain.com/api/servers/public | head -c 500
# JSON tidak ada field "domain"
```

### 11.6. ✅ Cloudflare protection

Aktifkan di Cloudflare dashboard:
- **Security → WAF → Managed Rules** → ON
- **Security → Bots → Bot Fight Mode** → ON (free plan tersedia)
- **Security → Settings → Security Level** → Medium
- **Speed → Optimization → Auto Minify** (HTML/CSS/JS) → ON
- **Caching → Configuration → Browser Cache TTL** → 4 hours

### 11.7. (Opsional) Block direct IP access

Tambah di `/etc/nginx/sites-available/ptsontoloyo-monitor`, di awal:

```nginx
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    ssl_certificate     /etc/ssl/cloudflare/your-domain.pem;
    ssl_certificate_key /etc/ssl/cloudflare/your-domain.key;
    server_name _;
    return 444;     # tutup koneksi tanpa response
}
```

`nginx -t && systemctl reload nginx`. Setelah ini, akses lewat `http://IP_VPS:port/` langsung di-drop. Hanya domain resmi yang merespons.

---

## STEP 12 — Auto-backup database harian

### 12.1. Buat script backup

```bash
nano /usr/local/bin/ptsontoloyo-backup.sh
```

Isi:

```bash
#!/usr/bin/env bash
# PT SONTOLOYO Monitor — daily database backup
set -e

BACKUP_DIR=/root/backups
APP_DIR=/root/ptsontoloyo-monitor
TS=$(date +%Y%m%d-%H%M%S)
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# atomic snapshot of SQLite (safe even while app is running)
sqlite3 "$APP_DIR/prod.db" ".backup '$BACKUP_DIR/ptsontoloyo-$TS.db'"

# also snapshot .env (in case you change it)
cp "$APP_DIR/.env" "$BACKUP_DIR/ptsontoloyo-$TS.env"
chmod 600 "$BACKUP_DIR"/*.env

# clean up old (>30 days)
find "$BACKUP_DIR" -name "ptsontoloyo-*.db"  -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "ptsontoloyo-*.env" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] backup ok: ptsontoloyo-$TS.db"
```

```bash
chmod +x /usr/local/bin/ptsontoloyo-backup.sh
```

### 12.2. Test manual

```bash
/usr/local/bin/ptsontoloyo-backup.sh
ls -la /root/backups/
```

Harus muncul `ptsontoloyo-YYYYMMDD-HHMMSS.db` + `.env`.

### 12.3. Pasang cron harian (jam 03:00)

```bash
nano /etc/cron.d/ptsontoloyo-backup
```

Isi:

```cron
0 3 * * * root /usr/local/bin/ptsontoloyo-backup.sh >> /var/log/ptsontoloyo-backup.log 2>&1
```

```bash
chmod 644 /etc/cron.d/ptsontoloyo-backup
systemctl restart cron
```

### 12.4. (Disarankan) Off-site backup

Salin ke storage lain pakai `rsync` ke S3-compatible (Backblaze B2, Wasabi) atau `scp` ke VPS lain. Kalau tertarik, kabari saya — saya buatkan template terpisah.

---

## STEP 13 — Optimasi performa mobile + VPS spek standar

> Bagian ini berisi rekomendasi yang sudah otomatis aktif + tips manual lanjutan.

### 13.1. ✅ Yang sudah otomatis aktif

- **PM2 max-memory-restart 512M** — kalau Next.js bocor memori, otomatis di-restart
- **Static asset cache 1 tahun** (nginx)
- **Recharts + framer-motion** — sudah tree-shake by Next.js production build
- **Gambar bendera** — di-cache CDN Cloudflare
- **SQLite** — zero overhead, sangat ringan untuk skala kecil-menengah

### 13.2. Polling frekuensi (ringan vs realtime)

Default `NEXT_PUBLIC_REFRESH_MS=10000` (10 detik). Kalau VPS-mu kecil (1 vCPU 1GB) atau mobile user banyak yang pakai paket data:

```bash
nano /root/ptsontoloyo-monitor/.env
# ubah ke 15000 atau 20000 (15-20 detik)
pm2 reload ptsontoloyo-monitor
```

**Trade-off:** lebih lama refresh = lebih hemat bandwidth + battery mobile.

### 13.3. Cloudflare cache static

Sudah enabled by default lewat header `Cache-Control: public, max-age=31536000, immutable` (set di nginx). Cloudflare otomatis cache `_next/static/*` sehingga user kedua dst. tidak hit VPS.

### 13.4. Disable detail polling kalau idle

Sudah otomatis: hooks polling pakai `useEffect` dengan cleanup, jadi kalau user tutup tab, polling stop.

### 13.5. Mobile-specific (sudah ter-handle)

UI existing sudah responsive (Tailwind mobile-first). Yang penting:
- Sidebar bisa di-toggle di mobile
- Card grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` — mobile auto 1 kolom
- Touch target ≥44px sudah default Tailwind `py-2.5` di tombol/link

### 13.6. Monitoring sumber daya VPS

```bash
# CPU + RAM real-time
htop

# memory PM2
pm2 monit
```

**Threshold sehat di VPS 1 vCPU 1GB:**
- Idle: CPU < 5%, RAM < 250MB
- Peak (sync + 10 user): CPU < 30%, RAM < 400MB

Kalau lebih: kasih tahu saya, kita pakai swap atau upgrade.

---

## Maintenance: update dari GitHub

Kalau saya/kamu push update ke `main` di GitHub dan kamu mau pull ke VPS:

```bash
cd /root/ptsontoloyo-monitor

# 1. Backup dulu (auto via Step 12, tapi bisa manual juga)
/usr/local/bin/ptsontoloyo-backup.sh
TS=$(date +%Y%m%d-%H%M%S)

# 2. Pull update
git fetch origin
git status              # pastikan tidak ada local change
git pull origin main

# 3. Reinstall dep + build
npm ci
npm run build
npx prisma db push      # idempotent, tidak hapus data

# 4. Reload PM2 (graceful, no downtime)
pm2 reload ptsontoloyo-monitor
pm2 save

# 5. Verifikasi
pm2 status
pm2 logs ptsontoloyo-monitor --lines 30
curl -I https://monitor.your-domain.com
```

**Estimasi total:** 2–3 menit. Downtime: ~1 detik (PM2 reload).

---

## Maintenance: rollback jika update gagal

Skenario: setelah `git pull` + build, app crash atau bug fatal. Kembalikan ke versi sebelumnya:

```bash
cd /root/ptsontoloyo-monitor

# 1. Cek commit terakhir yang sehat
git log --oneline -5

# 2. Reset ke commit sebelumnya
git reset --hard <COMMIT_SEBELUM_UPDATE>
# misal: git reset --hard 3b9cacb

# 3. Rebuild + reload
npm ci
npm run build
pm2 reload ptsontoloyo-monitor
pm2 logs ptsontoloyo-monitor --lines 30
```

**Kalau database juga rusak**, lanjut ke section restore di bawah.

---

## Maintenance: restore database

Ambil dari snapshot harian:

```bash
ls -la /root/backups/                            # cari file *.db terbaru sebelum kerusakan

cd /root/ptsontoloyo-monitor
pm2 stop ptsontoloyo-monitor
cp prod.db prod.db.broken                        # simpan yang rusak
cp /root/backups/ptsontoloyo-20260528-030000.db prod.db
pm2 reload ptsontoloyo-monitor
sqlite3 prod.db "PRAGMA integrity_check;"       # harus: ok
```

**Kalau .env juga ingin direstore:**
```bash
cp /root/backups/ptsontoloyo-20260528-030000.env .env
chmod 600 .env
pm2 reload ptsontoloyo-monitor
```

---

## Troubleshooting umum

| Gejala | Kemungkinan penyebab | Cara cek + fix |
|---|---|---|
| `502 Bad Gateway` di domain | PM2 mati / port 3000 tidak listening | `pm2 status` → harus online; `pm2 logs ptsontoloyo-monitor` lihat error |
| `521 Web server is down` (Cloudflare) | nginx mati atau ufw block 443 | `systemctl status nginx`; `ufw status` |
| `525 SSL handshake failed` | cert origin tidak match domain | Re-create cert di Cloudflare, pasang ulang di `/etc/ssl/cloudflare/` |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL = Flexible | Wajib **Full strict** |
| Login gagal "JWT decryption failed" | `NEXTAUTH_SECRET` baru diubah | `pm2 reload ptsontoloyo-monitor` + clear cookie browser |
| Server selalu OFFLINE di UI | Firewall provider block 8787 | Test dari dashboard: `curl http://IP_TARGET:8787/health` |
| `total_ssh`/`total_xray` = 0 padahal ada user | Path DB di VPS-mu beda | Cek `ls /etc/ssh/.ssh.db /etc/xray/.userall.db`, kasih tahu saya path-mu |
| Sync 401 dari cron | Token mismatch | Pastikan `MONITOR_SYNC_TOKEN` di .env = `X-Sync-Token` header di cron |
| `Prisma Client validation error` | `npm run build` belum jalan | `npm run build` ulang |
| Free disk space habis | Log + node_modules numpuk | `pm2 flush; apt clean; du -sh /root/.npm /tmp` |

---

## Checklist final production

Sebelum kamu anggap deploy selesai, centang ini:

- [ ] `https://monitor.your-domain.com` buka dengan gembok hijau
- [ ] Login admin sukses, dashboard tampil
- [ ] Public/member view: tidak terlihat IP/domain VPS target
- [ ] Admin view: bisa lihat detail penuh termasuk IP/domain
- [ ] Minimal 1 server target ONLINE di UI dengan data CPU/RAM beneran
- [ ] `pm2 status` → online, restart < 5
- [ ] `tail -3 /var/log/ptsontoloyo-sync.log` → ada `success:true` setiap menit
- [ ] `ls /root/backups/` → ada file backup (tunggu sampai jam 03:00 hari berikutnya)
- [ ] `ufw status` → 22, 80, 443 saja (tidak ada port lain terbuka)
- [ ] Cloudflare WAF + Bot Fight Mode aktif
- [ ] `.env` permission 600
- [ ] Mobile (browser HP) tampil rapi, dashboard responsive

Kalau semua ✅ — **kamu sudah production-ready.** 🎉

---

> Pertanyaan / stuck di step mana pun → kasih tahu nomor step + paste output errornya. Saya bantu debug.
>
> — PT SONTOLOYO Monitor by **PAKDE XRESX DIGITAL STORE**.
