# AI Sales Expansion Engine

A platform to help a company find where to expand sales next across Indian states/cities/industries, rank opportunities, and turn them into revenue. This repo currently implements **Phase 1**: Company profile, Product management, Sales data (manual + CSV import), an India geography/industry reference foundation, and a dashboard — all built on real entered data only. No AI scoring, prospect discovery, or market-size numbers are implemented yet; see `docs` in the codebase comments / architecture below for what's intentionally deferred to later phases.

## Stack

- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS, TanStack Query
- **Backend**: Node.js, Express, TypeScript, REST API, Prisma ORM
- **Database**: PostgreSQL
- **Auth**: JWT in httpOnly cookies, bcrypt password hashing, role-based access control (ADMIN / MANAGER / SALES_USER)

## Project layout

```
backend/            Express REST API + Prisma schema
frontend/            Next.js dashboard app
packages/shared/     Shared TypeScript types/enums used by both
docker-compose.yml   Local PostgreSQL
```

## Getting started

Prerequisites: Node.js 20+, pnpm, Docker Desktop (for local Postgres).

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres
docker compose up -d

# 3. Configure environment
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 4. Run migrations and seed reference data (states/cities/industries/business types)
pnpm db:migrate
pnpm db:seed

# 5. Run both apps in dev mode
pnpm dev
```

Backend runs on `http://localhost:4000`, frontend on `http://localhost:3000`.

The first user is created via the one-time bootstrap flow on the login screen ("Set up your company"), which creates the Company profile and the first ADMIN user together. Every subsequent user is invited by an ADMIN from the Users page.

## Data honesty principle

Every numeric value shown in the UI is tagged with where it came from: **Company data**, **Imported data**, **AI estimate**, **External data**, or **User assumption** (see `DataSourceType` in `packages/shared`). Phase 1 introduces no AI estimates — only real entered/imported data and factual India geography/industry reference lists (no invented market-size statistics anywhere).

## Phases

Phase 1 (this repo) → Phase 2 AI Market Opportunity Engine → Phase 3 Prospect Discovery → Phase 4 AI Prospect Scoring & Recommendations → Phase 5 Outreach/Follow-up → Phase 6 Revenue Prediction & Analytics → Phase 7 Advertising Integration → Phase 8 Distributor/Dealer Expansion → Phase 9 AI Autonomous Optimization.
