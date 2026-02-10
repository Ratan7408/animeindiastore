# HTTPS setup for API (api-store.animeindia.org)

Your store and admin use **HTTPS**. To avoid mixed-content and SSL errors, the API must be served over **HTTPS** too. This guide sets up **api-store.animeindia.org** for the anime store backend on your EC2 server.

**Note:** If **api.animeindia.org** is already used by another website, use a different subdomain (e.g. **api-store**) so each service has one hostname. This project uses **api-store.animeindia.org**.

## Prerequisites

- EC2 instance (e.g. 56.228.27.198) with the Node backend running on port 5000 (e.g. via PM2).
- A domain you control: **animeindia.org**. You will add a DNS record for **api-store.animeindia.org**.

---

## If you use Cloudflare (Proxied / orange cloud)

When **api-store.animeindia.org** is proxied through Cloudflare:

1. **Cloudflare serves HTTPS** to visitors. It then fetches from your EC2 over **HTTP on port 80** (when SSL mode is "Flexible").
2. You **do not need Certbot** on EC2. You only need **Nginx on port 80** on EC2 proxying to your Node app on port 5000.

**Do this:**

1. **On EC2:** Install Nginx and add a server block that listens on **port 80** and proxies to `http://127.0.0.1:5000` (see Step 2 and Step 3 below; skip Step 4 Certbot). Use **server_name api-store.animeindia.org** in the config.
2. **AWS Security Group:** Allow **inbound TCP port 80** from `0.0.0.0/0` so Cloudflare can reach your origin.
3. **In Cloudflare dashboard:**  
   **SSL/TLS** → **Overview** → set SSL/TLS encryption mode to **Flexible**.  
   (Flexible = HTTPS between visitor and Cloudflare, HTTP between Cloudflare and your server on port 80.)

After that, **https://api-store.animeindia.org** will work: visitor → Cloudflare (HTTPS) → your EC2:80 (HTTP) → Nginx → Node:5000.

---

## Step 1: DNS

In Cloudflare (or your DNS provider) add **one** A record for the anime store API (do not use the name **api** if that already points to another site):

- **Type:** A  
- **Name:** `api-store` (so it becomes api-store.animeindia.org)  
- **Content:** `56.228.27.198`  
- **Proxy:** Proxied (orange cloud) if using Cloudflare  
- **TTL:** Auto  

Keep **api** → 54.209.215.42 (or whatever) for your other website.

Wait a few minutes and check:

```bash
ping api-store.animeindia.org
```

It should resolve (often to Cloudflare IPs when proxied).

---

## Step 2: Install Nginx and Certbot on EC2

SSH into your EC2 instance, then:

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Amazon Linux 2
sudo yum install -y nginx
# Certbot: https://certbot.eff.org/instructions (choose Amazon Linux 2 and nginx)
```

---

## Step 3: Nginx config for api-store.animeindia.org

**Check which path your Nginx uses.** On the server run:

```bash
ls -la /etc/nginx/sites-available 2>/dev/null || ls -la /etc/nginx/conf.d
```

- If **sites-available** exists → use the Ubuntu/Debian steps below.
- If you get "No such file or directory" for sites-available but **conf.d** exists → use the **conf.d** steps below (common on Amazon Linux 2).

---

**Option A — conf.d (use this if sites-available doesn't exist):**

```bash
sudo nano /etc/nginx/conf.d/api-store.animeindia.org.conf
```

Paste this (then save: Ctrl+O, Enter, Ctrl+X):

```nginx
server {
    listen 80;
    server_name api-store.animeindia.org;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

**Option B — Ubuntu/Debian (sites-available):**

```bash
sudo nano /etc/nginx/sites-available/api-store.animeindia.org
```

Paste the same `server { ... }` block above, then:

```bash
sudo ln -s /etc/nginx/sites-available/api-store.animeindia.org /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Check that **http://api-store.animeindia.org** (port 80) returns your API (e.g. health: http://api-store.animeindia.org/api/health).

---

## Step 4: Get SSL certificate (Let's Encrypt)

Run Certbot so Nginx will get a certificate and auto-configure HTTPS:

```bash
sudo certbot --nginx -d api-store.animeindia.org
```

Follow the prompts (email, agree to terms). Certbot will add HTTPS to the same server block and set up auto-renewal.

Then test:

```bash
curl https://api.animeindia.org/api/health
```

You should get `{"status":"OK",...}` over HTTPS.

---

## Step 5: Open port 443 on EC2

In **AWS Console → EC2 → Security Groups** for your instance:

- Inbound: add **HTTPS (TCP 443)** from `0.0.0.0/0` (or your preferred range).

Port 80 is needed for the HTTP→HTTPS redirect and for Certbot; keep it open.

---

## Step 6: Backend .env

On EC2, in your backend `.env`, set:

```env
BACKEND_URL=https://api-store.animeindia.org
CORS_ORIGINS=https://store.animeindia.org,https://storeadmin.animeindia.org
```

Restart the Node app (e.g. `pm2 restart all`).

---

## Step 7: Frontend and admin builds

Your repo is already set to use the HTTPS API URL:

- **frontend/.env.production:** `VITE_API_URL=https://api-store.animeindia.org/api`
- **admin/.env.production:** `VITE_API_URL=https://api-store.animeindia.org/api`

Rebuild and redeploy:

```bash
cd frontend && npm run build
cd ../admin && npm run build
```

Upload the new `dist/` folders to Hostinger for store and admin. After that, the store and admin will call **https://api-store.animeindia.org/api** and no longer hit SSL or mixed-content errors.

---

## Summary

| Item | Value |
|------|--------|
| API domain | https://api-store.animeindia.org |
| Backend on EC2 | Runs on port 5000 (Node/PM2) |
| Nginx | Listens 80/443, proxies to 127.0.0.1:5000 |
| SSL | Let's Encrypt via Certbot |

If anything fails, check: `sudo nginx -t`, `sudo systemctl status nginx`, and PM2 logs for the Node app.
