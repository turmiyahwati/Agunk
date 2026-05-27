# Panduan Deploy Agunk (Pemula)

Panduan ini membawa kamu dari nol sampai dashboard live di domain sendiri,
dengan minimal 1 VPS VPN target yang termonitor secara realtime.

> **Stack final:** Next.js (PM2) + nginx + Cloudflare + SQLite + Python agent
> di tiap VPS VPN.

```
                      ┌──────────── Cloudflare ────────────┐
                      │  DNS + WAF + SSL (Full strict)     │
                      └──────────────┬─────────────────────┘
                                     │ 443 (TLS)
                              ┌──────▼──────┐
                              │   nginx     │   ← reverse proxy
                              │ 127.0.0.1   │
                              └──────┬──────┘
                                     │ 3000
                              ┌──────▼──────┐
                              │  Next.js    │   ← PM2-managed
                              │  (Agunk)    │
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

---

## Yang kamu butuhkan

- 1 VPS untuk dashboard (Debian 11/12 atau Ubuntu 22.04+, RAM 1 GB cukup).
- 1+ VPS VPN/Xray yang sudah jalan (target monitoring).
- 1 domain (boleh apa saja) yang sudah pointing ke Cloudflare.
- Akses SSH `root` di semua VPS.

> Rumus password/secret di bawah, **wajib ganti** dengan nilai random kamu sendiri:
> `openssl rand -base64 32` untuk secret panjang, `openssl rand -hex 24` untuk API key.

---

## STEP 1 — Siapkan VPS dashboard

SSH ke VPS dashboard, install Node 20 + git + curl:

```bash
# install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
node -v   # harus v20.x
```

(Opsional tapi disarankan) buat user non-root untuk run app:

```bash
sudo adduser --disabled-password --gecos "" agunk
sudo usermod -aG sudo agunk
sudo su - agunk
```

---

## STEP 2 — Clone project & konfigurasi

```bash
git clone https://github.com/<USER>/Agunk.git
cd Agunk

cp .env.example .env
nano .env
```

Isi minimal `.env` untuk production:

```env
DATABASE_URL="file:./prod.db"

# Generate dengan: openssl rand -base64 32
NEXTAUTH_SECRET="GANTI_DENGAN_RANDOM_PANJANG"
NEXTAUTH_URL="https://your-domain.com"

ADMIN_EMAIL="admin@your-domain.com"
ADMIN_PASSWORD="GANTI_PASSWORD_KUAT"
ADMIN_NAME="Admin Agunk"

# Token untuk cron auto-sync. Generate dengan: openssl rand -hex 32
MONITOR_SYNC_TOKEN="GANTI_DENGAN_TOKEN_RANDOM"

NEXT_PUBLIC_REFRESH_MS=10000
VPS_FETCH_TIMEOUT_MS=4000
VPS_FETCH_RETRIES=2
```

Build dan setup database:

```bash
npm ci
npm run build              # prisma generate + next build
npx prisma db push         # buat prod.db
npm run db:seed            # bikin user admin pertama
```

> Setelah seed, **ganti dulu password admin** lewat halaman Admin → Members
> (atau biarkan, kemudian login pakai email + password dari `.env`).

---

## STEP 3 — Jalankan dengan PM2

```bash
sudo npm i -g pm2
pm2 start ecosystem.config.js
pm2 save

# auto-start saat reboot
pm2 startup systemd
# ↑ output-nya akan kasih 1 baris perintah `sudo env PATH=... pm2 startup ...`
# COPAS dan jalankan.
```

Cek:

```bash
pm2 status
pm2 logs agunk --lines 50
curl -I http://127.0.0.1:3000        # harus HTTP/1.1 200
```

---

## STEP 4 — Pasang nginx (reverse proxy)

```bash
sudo apt-get install -y nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/agunk
sudo nano /etc/nginx/sites-available/agunk
# → ganti SEMUA `your-domain.com` dengan domain kamu
# → set path SSL cert (lihat STEP 5)

sudo ln -sf /etc/nginx/sites-available/agunk /etc/nginx/sites-enabled/agunk
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## STEP 5 — Cloudflare + SSL

1. Di Cloudflare dashboard → tab **DNS**, tambah record:
   - Type: `A`, Name: `@` (atau subdomain), IPv4: IP VPS dashboard,
     Proxy status: **Proxied** (awan oranye).
2. Tab **SSL/TLS → Overview** → pilih **Full (strict)**.
3. Tab **SSL/TLS → Edge Certificates** → enable **Always Use HTTPS** dan
   set **Minimum TLS Version** = `TLS 1.2`.
4. Tab **SSL/TLS → Origin Server** → klik **Create Certificate**, pilih
   default (RSA, 15 tahun). Simpan ke VPS:

   ```bash
   sudo mkdir -p /etc/ssl/cloudflare
   sudo nano /etc/ssl/cloudflare/your-domain.pem    # paste origin certificate
   sudo nano /etc/ssl/cloudflare/your-domain.key    # paste private key
   sudo chmod 600 /etc/ssl/cloudflare/*.key
   sudo nginx -t && sudo systemctl reload nginx
   ```

   Path ini sesuai `ssl_certificate` di `nginx.conf.example`.

5. (Alternatif) Kalau tidak mau pakai origin cert, pakai certbot:

   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

   Tapi karena Cloudflare proxy nyala, certbot HTTP-01 bisa fail; matikan
   dulu proxy-nya (awan jadi abu-abu) saat issue cert, baru aktifkan lagi.

Buka `https://your-domain.com` di browser → harus muncul landing page Agunk.

---

## STEP 6 — Cron auto-sync

```bash
sudo cp deploy/agunk-sync.cron /etc/cron.d/agunk-sync
sudo nano /etc/cron.d/agunk-sync
# → ganti YOUR_TOKEN dengan MONITOR_SYNC_TOKEN dari .env
# → ganti your-domain.com
sudo chmod 644 /etc/cron.d/agunk-sync
sudo systemctl restart cron
```

Tes manual:

```bash
curl -fsS -H "X-Sync-Token: TOKEN_KAMU" \
  -X POST https://your-domain.com/api/monitor/sync
# harus balik: {"total":0,"ok":0,"failed":0,"success":true,...}
```

(`total:0` wajar karena belum ada server. Lanjut step 7.)

---

## STEP 7 — Install agent di tiap VPS VPN

SSH ke VPS VPN target (yang sudah punya Xray + script provisioning di port 5888).

```bash
# upload folder vps-agent saja, contoh dengan git:
git clone https://github.com/<USER>/Agunk.git /tmp/agunk
cd /tmp/agunk/vps-agent

# install (otomatis generate API key kalau tidak diset)
sudo bash install.sh
```

Output installer akan menampilkan **API key**. **Catat baik-baik** — nanti
dipakai di Admin UI dashboard.

Verifikasi:

```bash
curl http://127.0.0.1:8787/health
curl -H "X-API-Key: <API_KEY>" http://127.0.0.1:8787/api/status
```

JSON yang keluar harus berisi `cpu`, `ram`, `total_ssh`, `total_xray`, dst.

> **Port 5888 (provisioning) tidak disentuh** — agent ini hanya buka 8787.

(Opsional, lebih aman) batasi firewall agar 8787 hanya bisa diakses dari IP
dashboard:

```bash
sudo ufw allow from <IP_DASHBOARD> to any port 8787 proto tcp
sudo ufw deny 8787/tcp
```

Ulangi STEP 7 untuk semua VPS yang mau dimonitor.

---

## STEP 8 — Hubungkan VPS ke dashboard

1. Login `https://your-domain.com/login` pakai admin dari `.env`.
2. Sidebar → **Admin → Servers → Tambah Server**.
3. Isi:
   - **Name**: nama bebas (misal "SG-1")
   - **Provider / Country / Domain or IP**: sesuai VPS
   - **VPS Agent base URL**: `http://<IP_VPS>:8787`
   - **API Key**: hasil installer di STEP 7
   - **Max Slot**: kapasitas user
4. Save → klik ikon **Wifi** di baris itu untuk **Test connection**. Kalau
   sukses, status berubah jadi `ONLINE` dalam beberapa detik.

Ulangi untuk tiap VPS.

---

## STEP 9 — Verifikasi realtime

- `/dashboard` (login member) → kartu server harus auto-update tiap
  `NEXT_PUBLIC_REFRESH_MS` (10 detik default).
- Klik salah satu server → halaman detail → grafik CPU/RAM/ping ngisi
  seiring data mengalir.
- Cek log cron:
  ```bash
  tail -n 20 /var/log/agunk-sync.log
  ```
- Cek log dashboard: `pm2 logs agunk`
- Cek log agent: `journalctl -u agunk-agent -f` (di sisi VPS VPN)

Selamat — monitoring kamu sudah live. 🎉

---

## Update aplikasi (zero downtime)

Di VPS dashboard:

```bash
cd /home/agunk/Agunk
git pull
npm ci
npm run build
npx prisma db push     # kalau ada perubahan schema
pm2 reload agunk       # graceful reload, tidak drop koneksi
```

## Update agent

Di VPS VPN:

```bash
cd /tmp/agunk
git pull
sudo bash vps-agent/install.sh   # idempotent, key lama tetap dipakai
```

## Backup database

SQLite, jadi cukup salin file:

```bash
cp /home/agunk/Agunk/prod.db /home/agunk/backups/prod-$(date +%F).db
```

Disarankan cron harian + rsync ke storage lain.

---

## Troubleshooting cepat

| Gejala                              | Cek ini                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `502 Bad Gateway` di domain         | `pm2 status` (Next.js mati?) + `nginx -t`                  |
| Server selalu `OFFLINE` di UI       | Dari VPS dashboard: `curl -H "X-API-Key:.." http://VPS:8787/api/status`. Kalau timeout → firewall agent |
| `total_ssh`/`total_xray` selalu 0   | Cek apakah `/etc/ssh/.ssh.db` dan `/etc/xray/.userall.db` ada di VPS. Kalau scriptmu pakai path lain, taruh di `/etc/agunk/ssh.users` (1 user per baris) |
| Cron tidak jalan                    | `sudo journalctl -u cron -n 50` + isi `/var/log/agunk-sync.log` |
| Cloudflare error 525 / 526          | SSL mode salah → set ke **Full (strict)** dan pastikan cert origin terpasang di nginx |
| Login gagal "JWT decryption failed" | `NEXTAUTH_SECRET` baru saja diubah → `pm2 restart agunk` dan logout-login ulang |
| Sync 401 dari cron                  | `X-Sync-Token` header tidak match `MONITOR_SYNC_TOKEN` di `.env` |

## Health-check satu liner

Dari mana saja:

```bash
curl -fsS https://your-domain.com/api/servers/public | jq '.servers | length'
```

Harus jumlah server > 0 setelah STEP 8.

---

## Yang TIDAK disentuh oleh deployment ini

- ✅ Script VPN existing (autoscript / installer Xray, dll)
- ✅ Konfigurasi Xray (`/usr/local/etc/xray/config.json`)
- ✅ Provisioning API di port **5888** (tetap jalan paralel)
- ✅ User database VPN (`/etc/ssh/.ssh.db`, `/etc/xray/.userall.db`) — agent
  hanya **membaca**, tidak pernah menulis.
