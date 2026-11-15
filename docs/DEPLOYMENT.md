# OrderFlow Production Deployment Guide

## 1. Prerequisites
- Docker & Docker Compose OR Node.js 20+ with PostgreSQL 15+
- Valid Domain with SSL Termination (Cloudflare, AWS ALB, or Nginx)
- Meta Developer App (for WhatsApp Business Cloud API & Instagram Messaging)

---

## 2. Environment Variables Specification

Ensure all variables are populated in `.env.production`:

| Variable | Description | Required | Example |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection pool URL | Yes | `postgresql://user:pass@host:5432/orderflow?pgbouncer=true` |
| `JWT_SECRET` | 32+ character key for signing session tokens | Yes | `crypto.randomBytes(32).toString('hex')` |
| `NEXT_PUBLIC_APP_URL` | Canonical public URL of the application | Yes | `https://app.orderflow.io` |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token for Meta | Yes | Custom secret string |
| `NODE_ENV` | Runtime environment | Yes | `production` |

---

## 3. Deployment Options

### Option A: Docker Compose (Single Host / VPS)
```bash
# 1. Clone repository
git clone https://github.com/orderflow/orderflow.git /opt/orderflow
cd /opt/orderflow

# 2. Configure environment
cp .env.example .env.production
nano .env.production

# 3. Build & start containers
docker compose up -d --build

# 4. Run Prisma database migration
docker compose exec app npx prisma db push
```

### Option B: Cloud Platform (Vercel + Neon / AWS ECS)
1. Link GitHub repository to Vercel or cloud provider.
2. Configure environment variables in dashboard.
3. Build command: `npm run build` (runs `prisma generate && next build`).
4. Set healthcheck endpoint to `/api/health`.

---

## 4. Post-Deployment Verification
Verify operational health via the dedicated health probe:
```bash
curl -i https://your-domain.com/api/health
```
Expected output: HTTP 200 with `status: "healthy"` and database latency metrics.
