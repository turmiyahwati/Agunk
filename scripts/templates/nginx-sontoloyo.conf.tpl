# =============================================================================
# PT Sontoloyo Monitor — nginx site config (template)
# Rendered by scripts/install-dashboard.sh: every {{DOMAIN}} placeholder is
# replaced with the real hostname before this file lands at
# /etc/nginx/sites-available/sontoloyo.
# =============================================================================

# Hide nginx version (security)
server_tokens off;

# Trust Cloudflare edge IPs so $remote_addr resolves to the real visitor IP.
# CIDR list mirrors https://www.cloudflare.com/ips/ as of 2025-Q4.
# Update if Cloudflare publishes new ranges (rare but possible).
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

# ── Plain HTTP → force HTTPS ──────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name {{DOMAIN}};
    return 301 https://$host$request_uri;
}

# ── HTTPS ─────────────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {{DOMAIN}};

    # Cloudflare-issued Origin Certificate (15 years).
    ssl_certificate     /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    # Defense-in-depth headers (Next.js also sets these per response, but
    # belt-and-braces here protects static error pages too).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Logo upload max size — keep this smaller than the in-app limit
    # (1 MB) to fail fast at the proxy when someone tries to push a huge
    # file straight at the upstream.
    client_max_body_size 5m;
    proxy_read_timeout 60s;

    # Block dotfiles (e.g. .git, .env, .DS_Store) — except .well-known
    # which Let's Encrypt-style verification might use.
    location ~ /\.(?!well-known) {
        deny all;
        access_log off;
        return 404;
    }

    # Long-cache static Next.js assets (filenames are content-hashed).
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Long-cache uploads (operator-managed logo). The app uses
    # timestamped filenames so cache busts automatically on replace.
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Realtime API — never cached (some routes set their own short SWR).
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    # Catch-all → Next.js (App Router pages + assets that didn't match above).
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
