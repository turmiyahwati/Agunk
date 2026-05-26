# PT Sontoloyo Monitor — Deployment Guide

Quick reference for running the panel locally, building production, deploying
behind nginx + Cloudflare, and keeping the database backed up.

---

## 1. Run di localhost (VSCode)

```bash
git clone https://github.com/turmiyahwati/Agunk.git sontoloyo-monitor
cd sontoloyo-monitor

# (auto-creates .env from .env.example on first dev/build)
npm install
npm run setup     # check-env + prisma generate + db push + seed
npm run dev       # http://localhost:3000
```

Login admin default:
- email: `admin@sontoloyo.local`
- password: `admin123`

Ganti `NEXTAUTH_SECRET` di `.env` sebelum production:
```bash
openssl rand -base64 32
```

---

## 2. Build production

```bash
npm run build       # next build, output di .next/
npm run start       # serve di port 3000
```

---

## 3. Deploy ke VPS (PM2 + Nginx)

### Setup process manager
```bash
cd /opt/sontoloyo-monitor
git pull origin main
npm ci
npm run build
npx prisma db push
npm run db:seed     # only first time

npm i -g pm2
pm2 start "npm run start" --name sontoloyo
pm2 save
pm2 startup        # follow the printed command
```

### Nginx reverse proxy

```nginx
# /etc/nginx/sites-available/sontoloyo
server {
    listen 80;
    server_name your-domain.com;

    # Forward real client IP for rate limiter (lib/rate-limit.ts)
    real_ip_header X-Forwarded-For;
    set_real_ip_from 127.0.0.1;

    # Compression: handled at the proxy layer for upstream traffic.
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;
    # Optional brotli (if module present): brotli on; brotli_types ...;

    # Static asset caching
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # API: never cached
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP        $remote_addr;
        proxy_buffering off;        # streaming-friendly
    }

    # Everything else
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP        $remote_addr;
    }
}
```

Aktifkan + sertifikat HTTPS:
```bash
sudo ln -s /etc/nginx/sites-available/sontoloyo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

---

## 4. Cloudflare (di depan Nginx)

Saat Cloudflare terpasang, real client IP datang lewat `CF-Connecting-IP`.
Rate limiter (`src/lib/rate-limit.ts`) sudah membaca header ini secara
otomatis, jadi tidak ada yang perlu di-tweak di kode.

Setting yang disarankan di Cloudflare dashboard:

| Bagian | Setting | Value |
|--------|---------|-------|
| SSL/TLS | Mode | Full (strict) |
| SSL/TLS → Edge Certificates | Always Use HTTPS | On |
| SSL/TLS → Edge Certificates | Automatic HTTPS Rewrites | On |
| SSL/TLS → Edge Certificates | Min TLS Version | 1.2 |
| Speed → Optimization | Brotli | On |
| Speed → Optimization | Auto Minify | JS, CSS, HTML |
| Caching → Configuration | Caching Level | Standard |
| Caching → Configuration | Browser Cache TTL | Respect Existing Headers |
| Security → WAF | Managed Rules | Enabled |
| Security → Bots | Bot Fight Mode | On (gratis di Free plan) |
| Security → DDoS | Sensitivity | High |
| Network | HTTP/2, HTTP/3 (QUIC) | On |

**Page Rule / Configuration Rule (recommended):**

```
URL: your-domain.com/api/*
Cache Level: Bypass
```

Ini supaya respons API realtime tidak di-cache di edge.

**Optional rate limit di Cloudflare Free plan:**
- Security → Rate limiting rules → 50 req / 10s per IP untuk `/api/auth/*`
  (defense-in-depth di luar rate limiter aplikasi)

---

## 5. Database backup otomatis

Manual:
```bash
npm run db:backup
# → creates backups/db-<ISO>.db, auto-deletes files older than 14 days
```

Cron daily (di VPS, Linux):
```bash
crontab -e

# tambahkan baris ini (jalan setiap hari jam 02:30)
30 2 * * * cd /opt/sontoloyo-monitor && /usr/bin/node scripts/backup-db.mjs >> /var/log/sontoloyo-backup.log 2>&1
```

Atau pakai npm via cron:
```bash
30 2 * * * cd /opt/sontoloyo-monitor && /usr/bin/npm run db:backup >> /var/log/sontoloyo-backup.log 2>&1
```

Atur retention via env:
```bash
BACKUP_RETENTION_DAYS=30 npm run db:backup
```

**PostgreSQL / MySQL:** script akan print perintah cron yang sesuai
(`pg_dump`/`mysqldump`) dan exit. Salin perintah tersebut ke crontab.

Restore SQLite cukup copy file kembali:
```bash
cp backups/db-2026-05-26T02-30-00.db prisma/dev.db
pm2 restart sontoloyo
```

---

## 6. Hosting panel (cPanel / Plesk / aaPanel)

1. Pull code via panel terminal/SSH
2. Run `npm install`
3. Run `npm run build`
4. Buka panel Node.js manager → **Start command**: `npm run start`
5. Tambahkan env variables dari `.env.example`
6. Tambahkan cron `0 2 * * * cd <path> && npm run db:backup` untuk backup

---

## 7. Checklist production

- [ ] `NEXTAUTH_SECRET` di-rotate ke value random
- [ ] `MONITOR_SYNC_TOKEN` diisi dengan token kuat
- [ ] Database PostgreSQL untuk multi-instance, atau SQLite untuk single VPS
- [ ] Cloudflare Full (strict) + HTTPS only
- [ ] Nginx forward `X-Forwarded-For` dan `X-Real-IP`
- [ ] PM2 startup hook diaktifkan (`pm2 startup`)
- [ ] Cron backup harian aktif
- [ ] UFW: hanya port 22 (admin SSH only) + 80/443 (proxy) yang terbuka
- [ ] VPS Agent (`vps-agent/`) di-firewall supaya hanya menerima koneksi
      dari IP dashboard (atau di belakang Cloudflare Tunnel)

---

## 8. Yang sudah dijaga aplikasi

- Public API tidak pernah membocorkan `domain`, `apiKey`, `apiUrl`,
  `lastError` dari server VPS.
- Public IP tidak pernah masuk ke search/filter.
- Private/internal IP otomatis di-mask via `lib/sanitize.ts`.
- Rate limit per IP di semua endpoint API (90/min public, 30/min admin
  write, 6/min monitor sync, 5/min login + per-email anti-bruteforce).
- Secure headers: HSTS, X-Frame-Options DENY, CSP, Referrer-Policy,
  Permissions-Policy, Cross-Origin-Opener-Policy, no `X-Powered-By`.
- `safeErrorMessage()` mencegah leak stack trace di production.
- Polling otomatis pause saat tab di background (hemat baterai HP).
- `productionBrowserSourceMaps: false` mencegah source code asli ke client.

---

Untuk setup VPS Agent (file Python yang di-install di tiap VPN/Xray VPS),
lihat `vps-agent/README.md`.
