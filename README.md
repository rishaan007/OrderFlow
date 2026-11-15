# OrderFlow — Next-Gen Multi-Tenant Social Commerce SaaS

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748?style=flat&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat&logo=postgresql)](https://www.postgresql.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-50%2F50%20Passed-brightgreen?style=flat)]()
[![Status](https://img.shields.io/badge/Beta%20Readiness-Production%20Ready-success?style=flat)]()

**OrderFlow** is a modern, production-grade, multi-tenant B2B SaaS order management and conversational commerce platform. Designed specifically for Instagram merchants, WhatsApp sellers, DTC brands, home businesses, and independent retail teams, OrderFlow unifies chaotic social direct messages into confirmed orders, synchronizes live inventory across multi-variant catalogs, orchestrates payment reconciliation, tracks multi-carrier shipments, and delivers real-time business intelligence with strict tenant data isolation.

---

## 🌟 Executive Summary & Phase Progression

| Phase | Milestone | Scope & Core Capabilities | Status |
|---|---|---|---|
| **Phase 1** | **Foundation & Multi-Tenancy** | Next.js 14, TypeScript strict mode, Tailwind CSS UI library, PostgreSQL & Prisma relational schema, Supabase Auth + JWT fallback, multi-tenant business data isolation, onboarding workspace wizard, and responsive sidebar navigation. | **Completed** ✅ |
| **Phase 2** | **Core Business & Inventory Engine** | Product catalog with multi-variants (SKU, size, price, cost), Customer CRM, dynamic order pricing (discounts, tax, delivery), atomic stock deductions and auto-restorations on cancellation, low-stock thresholds, and paginated search. | **Completed** ✅ |
| **Phase 3** | **Unified Inbox & AI Extraction** | Unified communication inbox (WhatsApp, Instagram, Manual), message threading, customer-thread resolution, AI-assisted conversational order details extraction, product fuzzy matching, missing-data detection, order approval gateway. | **Completed** ✅ |
| **Phase 4** | **Payments, Delivery & Automation** | Financial records (UPI, Cash, Bank Transfer), proof screenshot uploads, manual review & rejection workflows, partial payments, outstanding balances, multi-carrier shipment tracking (BlueDart, Delhivery, etc.), and automated background jobs. | **Completed** ✅ |
| **Phase 5** | **SaaS Beta Launch & Analytics** | Real-time database revenue & order analytics, SVG sales charts, product performance, customer retention & LTV metrics, outstanding receivables, RFC-4180 CSV exports, subscription plans & hard quota enforcement, team invitations & RBAC, rate limiting, and automated backups. | **Completed** ✅ |

---

## 🏗️ System Architecture

```
                                  ┌───────────────────────────┐
                                  │   Clients & Integrations  │
                                  │ (Web App, WhatsApp, IG)   │
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │    Next.js 14 App Router  │
                                  │  Rate Limiting & Auth MW  │
                                  └─────────────┬─────────────┘
                                                │
                     ┌──────────────────────────┼──────────────────────────┐
                     ▼                          ▼                          ▼
        ┌─────────────────────────┐┌─────────────────────────┐┌─────────────────────────┐
        │   Tenant DB Accessor    ││   Conversational Engine ││   Business Intelligence │
        │  • Workspace Isolation  ││  • Channel Ingestion    ││  • Live SQL Analytics   │
        │  • RBAC & Quotas        ││  • AI Order Extraction  ││  • Retention & LTV      │
        │  • Atomic Transactions  ││  • Message Persistence  ││  • RFC-4180 CSV Export  │
        └────────────┬────────────┘└────────────┬────────────┘└────────────┬────────────┘
                     │                          │                          │
                     └──────────────────────────┼──────────────────────────┘
                                                │
                                                ▼
                                  ┌───────────────────────────┐
                                  │   PostgreSQL Relational   │
                                  │    Database via Prisma    │
                                  │  (Cascade & SetNull Keys) │
                                  └───────────────────────────┘
```

---

## 🚀 Key Feature Breakdown

### 1. Unified Social Commerce Inbox
- **Multi-Channel Aggregation:** Unifies conversations from WhatsApp Business Cloud API, Instagram Messaging API, and Manual Walk-in channels.
- **AI-Assisted Order Extraction:** Parses unstructured conversational text into structured line items, quantities, buyer addresses, and payment references.
- **Human-in-the-Loop Seller Approval:** Prevents duplicate orders with editable preview modals and one-click order confirmation.

### 2. Multi-Variant Product Catalog & Inventory Protection
- **Multi-Level Variants:** Allows products to define distinct SKUs, prices, costs, and stock levels for sizes, colors, and options.
- **ACID Stock Transitions:** Automatically deducts stock upon order confirmation; automatically restores inventory if orders are cancelled.
- **Low-Stock Alerting:** Configurable warning thresholds with visual indicators.

### 3. Payment Processing & Financial Reconciliation
- **Flexible Payment Methods:** Full support for UPI reference IDs, Cash on Delivery, Bank NEFT/RTGS, and Credit/Debit Cards.
- **Partial Payments & Balances:** Tracks multiple partial payments per order, updating payment statuses (`PENDING` $\to$ `PARTIALLY_PAID` $\to$ `PAID`).
- **Outstanding Balance Engine:** Real-time visibility into pending receivables across non-cancelled orders.

### 4. Logistics & Delivery Management
- **Carrier Agnostic:** Pre-configured support for BlueDart, Delhivery, Shiprocket, Porter, Dunzo, FedEx, and Local Couriers.
- **Shipment Lifecycle:** Real-time state transitions: `PENDING` $\to$ `DISPATCHED` $\to$ `IN_TRANSIT` $\to$ `OUT_FOR_DELIVERY` $\to$ `DELIVERED` (with failed delivery and return handling).

### 5. SaaS Analytics, Subscription & Team Governance
- **Zero Mock Analytics:** Gross revenue, net sales, AOV, channel attribution, and repeat rates computed on the fly from PostgreSQL records.
- **Subscription Architecture:** Three tier levels (`FREE`, `PRO`, `ENTERPRISE`) with hard monthly quota enforcement on order throughput and team seats.
- **Role-Based Access Control (RBAC):** Cryptographically signed 7-day team invitations, member seat limits, and role enforcement (`OWNER`, `ADMIN`, `MANAGER`, `STAFF`).
- **Audit Trail & Observability:** Structured JSON logger with credential scrubbing and tamper-evident audit logs.

---

## 📊 Database Schema (Prisma)

OrderFlow features 13 relational models and 13 enums:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Core Multi-Tenant Models
model User            // System accounts and Supabase auth mapping
model Business        // Isolated workspace entity with plan, currency & limits
model BusinessMember  // Pivot table linking Users to Businesses with RBAC
model BusinessProfile // Social handles, WhatsApp credentials, bank details
model TeamInvitation  // Secure invitation tokens with 7-day expiration

// Commerce & Customer Models
model Customer        // Customer registry with totalSpent & ordersCount
model Product         // Catalog items with tracking and stock thresholds
model ProductVariant  // Sizing/options with individual price and stock counts
model Order           // Core order record with financial snapshots
model OrderItem       // Line items with product/variant relational links

// Communication, Logistics & Audit
model Conversation    // Channel thread with lastMessage and extracted metadata
model Message         // Threaded text, image, and order inquiry payloads
model Payment         // Audit-logged payments with verification workflow
model Shipment        // Carrier delivery tracking and address dispatch
model AuditLog        // Security and administrative event records
model AutomationJob   // Background event worker queue
model Notification    // Outbound omnichannel alerts
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | [Next.js 14](https://nextjs.org/) (App Router, Server Components & Client Hydration) |
| **Language** | [TypeScript 5](https://www.typescriptlang.org/) (Strict Mode) |
| **Styling & UI** | [Tailwind CSS 3.4](https://tailwindcss.com/), Lucide Icons, Class Variance Authority |
| **Database & ORM** | [PostgreSQL 16](https://www.postgresql.org/), [Prisma ORM 5.22](https://www.prisma.io/) |
| **Authentication** | Supabase Auth SDK (`@supabase/ssr`, `@supabase/supabase-js`), Bcrypt.js, JsonWebToken |
| **Security & Audits** | In-Memory Sliding Window Rate Limiter, Structured JSON Logger, Cryptographic Tokens |
| **Testing Engine** | [Vitest 2.1](https://vitest.dev/) (Full multi-phase integration and unit suite) |
| **Containerization** | Docker Multi-Stage Build, Docker Compose |

---

## 🧪 Testing Suite & Quality Gates

OrderFlow enforces strict automated test verification across all business phases. All **50 acceptance tests** pass cleanly:

```bash
npm test
```

```text
 ✓ tests/auth.test.ts (5 tests)
   • Password hashing with bcrypt
   • Zod registration schema validation
   • JWT session token issuance and verification
   • Duplicate email registration rejection

 ✓ tests/business-onboarding.test.ts (3 tests)
   • Workspace slugification and uniqueness
   • Owner role assignment and profile setup
   • Multi-tenant profile updates

 ✓ tests/tenant-isolation.test.ts (4 tests)
   • Workspace membership verification
   • Customer isolation between tenants
   • Product catalog isolation
   • Order metrics isolation

 ✓ tests/phase2-business-management.test.ts (12 tests)
   • Product variant creation and initial inventory
   • Low-stock detection algorithms
   • Atomic stock deductions on order confirmation
   • Automatic stock restoration upon order cancellation
   • Insufficient inventory exception handling
   • Paginated search, sorting, and status filtering

 ✓ tests/phase3-unified-inbox.test.ts (11 tests)
   • Omnichannel conversation intake (WhatsApp & Instagram)
   • Customer thread auto-linking
   • AI order details extraction and product matching
   • Missing address and quantity detection
   • Order approval and creation from conversation
   • Webhook signature challenges and verification

 ✓ tests/payments.test.ts (3 tests)
   • Pending payment recording
   • Merchant verification and order amountPaid updates
   • Multiple partial payment reconciliation

 ✓ tests/phase5-beta-launch.test.ts (12 tests)
   • Revenue, net sales, and AOV from live database orders
   • Top product velocity and inventory valuation
   • Customer retention, repeat rates, and LTV calculation
   • Payment distribution and outstanding balance detection
   • RFC-4180 CSV export generation with UTF-8 BOM
   • Subscription plan quota enforcement (hard limit halts)
   • Team member invitations, token acceptance, and RBAC
   • API sliding window rate limiting
   • Sensitive data scrubbing in structured logs
   • Complete end-to-end conversation-to-delivered order lifecycle

Test Files  7 passed (7)
     Tests  50 passed (50)
  Duration  1.15s
```

---

## ⚡ Getting Started

### 1. Prerequisites
- **Node.js**: v20 or higher
- **PostgreSQL**: v15 or higher
- **npm** or **pnpm**

### 2. Installation & Setup

```bash
# 1. Clone the repository
git clone https://github.com/rishaan007/OrderFlow.git
cd OrderFlow

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
```

Ensure `.env` contains your PostgreSQL database URL:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orderflow?schema=public"
JWT_SECRET="your-32-character-secret-key-for-sessions"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"
```

```bash
# 4. Synchronize database schema
npx prisma db push

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🐳 Production Container Deployment

OrderFlow includes a production-ready, multi-stage Dockerfile and Docker Compose orchestration configuration:

```bash
# Build and run containers
docker compose up -d --build
```

### Operational Health Probe
Verify container uptime and database connectivity:
```bash
curl -i http://localhost:3000/api/health
```
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "environment": "production",
  "uptime": "120s",
  "database": {
    "status": "healthy",
    "latencyMs": 4
  }
}
```

---

## 💾 Database Backup & Disaster Recovery

Automated daily backup and recovery scripts are included in `scripts/`:

```bash
# Run automated compressed backup with SHA256 checksums
./scripts/backup-db.sh

# Restore snapshot to target database (requires confirmation)
./scripts/restore-db.sh ./backups/orderflow_backup_YYYYMMDD_HHMMSS.sql.gz
```

For complete recovery procedures, read [docs/DATABASE_BACKUP.md](docs/DATABASE_BACKUP.md).

---

## 📄 License

This project is licensed under the MIT License — see the LICENSE file for details.
