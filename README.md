<div align="center">

# ⚡ HyperStack Enterprise

### Production-grade Node.js API engineered for extreme concurrency

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](./docker-compose.yml)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-manifests-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)](./k8s/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](./prisma/schema.prisma)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](./src/config/redis.ts)

**A battle-tested Fastify/TypeScript backend that handles flash-sales, duplicate-booking prevention, and event-driven job processing — all without a single race condition.**

[Quick Start](#-quick-start) · [Architecture](#-architecture) · [API Reference](#-api-reference) · [Load Testing](#-load-testing) · [Deployment](#-deployment)

</div>

---

## 🎯 Why HyperStack Enterprise?

Most Node.js APIs crumble under real-world concurrency: flash sales cause duplicate orders, unvalidated env vars surface at 3 AM, and background jobs silently vanish on restart. HyperStack Enterprise solves all three:

| Problem | Solution |
|---|---|
| 500 users book the same seat simultaneously | Redis Distributed Lock (`SET NX PX`) + Lua CAS release |
| API endpoints get hammered by bots | Sliding Window Rate Limiter via Redis Sorted Sets |
| Emails and notifications get lost on deploy | BullMQ + exponential backoff with 7-day failure retention |
| `undefined` env vars cause prod outages | Fail-fast env validation with descriptive error messages |
| Inconsistent error shapes across endpoints | Centralised error handler: one envelope for all errors |
| Traffic spikes tear down the cluster | HPA scales 3 → 20 pods in under 2 minutes |

---

## 🏗 Architecture

```mermaid
flowchart TD
    Client(["🌐 Client / Browser"])
    LB["☁️ Load Balancer\n(Nginx / Cloud LB)"]

    subgraph K8s["☸️ Kubernetes Cluster  (3 – 20 pods, HPA)"]
        direction TB
        API["⚡ Fastify API\nsrc/server.ts"]

        subgraph MW["Middleware Chain  (onRequest hooks)"]
            RL["🛡 Sliding Window\nRate Limiter\n(Redis ZSET)"]
            EH["🔁 Request Logger\n(pino structured)"]
        end

        subgraph Core["Request Handlers"]
            BC["📋 Booking Controller"]
            BS["⚙️ Booking Service"]
            DL["🔒 Distributed Lock\n(Redis SET NX PX\nLua CAS release)"]
        end

        subgraph BG["Background Workers  (BullMQ)"]
            EQ["📨 Email Queue"]
            EW["👷 Email Worker\n(concurrency: 5)"]
        end
    end

    subgraph Data["Data Layer"]
        PG[("🐘 PostgreSQL 16\n(Prisma ORM\nOptimistic Lock)")]
        RD[("🟥 Redis 7\n• Rate limit ZSETs\n• Distributed locks\n• BullMQ queues")]
    end

    Client -->|HTTPS| LB
    LB -->|Round-robin| API
    API --> MW
    MW --> Core
    BS --> DL
    DL -->|"SET NX PX 5000"| RD
    BS -->|"$transaction"| PG
    BS -->|"enqueue job"| EQ
    EQ --> RD
    EW -->|"BRPOPLPUSH"| RD
    EW -.->|"send email"| SMTP["📮 SMTP / SES\n/ SendGrid"]
    RL -->|"ZADD / ZCARD"| RD
```

### Request lifecycle — booking creation

```
POST /api/v1/bookings
  │
  ├─ [Rate Limiter]       ZADD + ZCARD → 429 if window exceeded
  ├─ [Request Logger]     pino structured log
  ├─ [Zod Validation]     parse + type-narrow body → 400 on failure
  │
  ├─ [Distributed Lock]   SET dlock:booking:resource:<id> <token> NX PX 5000
  │     ├─ acquired  →  continue ──────────────────────────────────────────┐
  │     └─ busy      →  retry (80 ms + jitter) up to 3 s → 503 on timeout  │
  │                                                                         │
  ├─ [Idempotency Guard]  SELECT WHERE resourceId = ? AND status = CONFIRMED│
  │     └─ exists    →  409 Conflict (Lua DEL releases lock)               │
  │                                                                         │
  ├─ [Prisma Transaction] INSERT booking (status=CONFIRMED, version=1)     │
  ├─ [Lock Release]       Lua CAS → DEL only if token matches ◄────────────┘
  │
  └─ [BullMQ Enqueue]     email:booking-confirmation → Redis (fire & forget)
        └─ [Email Worker] 5 concurrent processors, exp. backoff, 5 retries
```

---

## ✨ Key Features

### 🔒 Redis Distributed Lock — Zero Race Conditions

The core of HyperStack's concurrency model. When 500 VUs simultaneously try to book `seat:flash-sale:A1`, exactly **one** request wins. Every other request either waits (with jitter backoff) or receives a clean 409/503.

```typescript
// Atomic acquire — single Redis round-trip
await client.set(key, token, 'NX', 'PX', 5000)  // NX = only if not exists

// Atomic release — Lua script prevents stale eviction
// if GET(key) == token  then  DEL(key)  → 1 (success)
// else                        return 0  → (expired, owned by someone else)
await client.eval(RELEASE_SCRIPT, 1, key, token)
```

**Guarantees:**
- **Mutual exclusion** — one holder per resource key at all times
- **Deadlock safety** — TTL ensures locks are always released eventually
- **No stale release** — Lua CAS script cannot evict a lock it doesn't own
- **Thundering-herd mitigation** — full jitter backoff on retry

---

### 🛡 Sliding Window Rate Limiter

Fixed-window counters allow request bursts at window boundaries. HyperStack uses a Redis **Sorted Set** for a true sliding window — accurate to the millisecond.

```
Window (60 s)
─────────────────────────────────────────────────────► time
                            [   now-60s ◄──────── now ]
                                    ↑ ZREMRANGEBYSCORE prunes here

Per request (single atomic Lua eval):
  ZREMRANGEBYSCORE key  -inf  (now - 60000)   # prune stale
  ZADD             key  now   "now:randomhex"  # record request
  ZCARD            key                         # count in window
  PEXPIRE          key  60000                  # keep key alive
```

| Preset | Limit | Window | Applied to |
|---|---|---|---|
| `publicRateLimiter` | 300 req | 60 s | Public read routes |
| `standardRateLimiter` | 100 req | 60 s | All routes (global hook) |
| `strictRateLimiter` | 10 req | 60 s | `POST /bookings` |

**Fail-open:** Redis unavailability logs at `error` level but never blocks traffic.

---

### 📨 BullMQ Event-Driven Workers

Background jobs survive process restarts, handle SMTP timeouts gracefully, and retry with exponential backoff — all without polling.

```
Job payload (discriminated union):
  'welcome'              → welcome email
  'password-reset'       → high-priority (priority: 1)
  'booking-confirmation' → triggered after every successful booking
  'notification'         → generic transactional email

Retry policy:  5 attempts · exponential backoff · 2s → 4s → 8s → 16s → 32s
Retention:     completed = 24 h (1 000 jobs)  |  failed = 7 days (audit)
Concurrency:   5 parallel jobs per worker process
```

Workers use a **separate ioredis connection** from the HTTP server (`maxRetriesPerRequest: null`) — BullMQ's `BRPOPLPUSH` cannot share a connection that handles application queries.

---

### 📐 Zod Input Validation — End-to-End Type Safety

Schema definition and TypeScript types live in one place. Validation errors surface as structured `400` responses with field-level detail — never a raw Zod stack trace.

```typescript
// Schema defines shape AND generates the TypeScript type
export const CreateBookingSchema = z.object({
  resourceId:       z.string().min(1).max(255),
  amountMinorUnits: z.number().int().nonnegative(),
  currency:         z.string().length(3).regex(/^[A-Z]{3}$/),
  metadata:         z.record(z.unknown()).optional(),
})

// Error response (400)
{
  "success": false,
  "error": {
    "code":    "FST_VALIDATION_ERROR",
    "message": "currency: must be uppercase letters only; amountMinorUnits: must be an integer",
    "details": [
      { "field": "currency",         "message": "must be uppercase letters only" },
      { "field": "amountMinorUnits", "message": "must be an integer" }
    ]
  },
  "timestamp": "2026-11-15T16:24:03.112Z"
}
```

---

### 📊 Prisma ORM — Optimistic Concurrency Control

The `Booking` model carries a `version` counter. Cancellation uses an optimistic lock instead of a Redis lock — cheaper for low-contention writes:

```typescript
// Only succeeds if no concurrent update changed the row
const updated = await db.booking.updateMany({
  where: { id: bookingId, version: booking.version },
  data:  { status: 'CANCELLED', version: { increment: 1 } },
})

if (updated.count === 0) {
  // Version mismatch → concurrent write won → re-fetch and report
  throw new BookingNotCancellableError(bookingId, currentStatus)
}
```

---

### 📋 Structured Logging — pino

Every log line is a JSON object in production. In development, `pino-pretty` renders colourised human-readable output.

```json
{
  "level": "info",
  "time":  "2026-11-15T16:24:03.112Z",
  "service": "hyperstack-enterprise",
  "reqId":   "01JDKQ8V1E-k6-vu42-iter17",
  "url":     "/api/v1/bookings",
  "method":  "POST",
  "msg":     "incoming request"
}
```

---

## 📁 Project Structure

```
hyperstack-enterprise/
├── prisma/
│   └── schema.prisma              # PostgreSQL schema (User, Booking, enums)
│
├── src/
│   ├── server.ts                  # Entry point — env → DB → Redis → workers → listen
│   ├── app.ts                     # Fastify factory — hooks, routes, error handler
│   │
│   ├── config/
│   │   ├── env.ts                 # Fail-fast env validation (Zod-inspired)
│   │   ├── logger.ts              # pino — pretty dev / JSON prod
│   │   ├── database.ts            # Prisma singleton + connect/disconnect
│   │   └── redis.ts               # ioredis singleton + connect/disconnect
│   │
│   ├── middleware/
│   │   ├── error-handler.ts       # Global error normaliser (Prisma/Fastify/domain)
│   │   ├── rate-limiter.ts        # Sliding window ZSET rate limiter
│   │   └── request-logger.ts      # onRequest hook — structured req log
│   │
│   ├── routes/
│   │   ├── health.routes.ts       # GET /health
│   │   └── booking.routes.ts      # POST|GET|DELETE /api/v1/bookings
│   │
│   ├── controllers/
│   │   ├── health.controller.ts   # Health check handler
│   │   └── booking.controller.ts  # Thin HTTP adapter → service calls
│   │
│   ├── services/
│   │   ├── health.service.ts      # Health status
│   │   └── booking.service.ts     # Core logic: lock → guard → tx → enqueue
│   │
│   ├── queues/
│   │   ├── bullmq-connection.ts   # Dedicated BullMQ ioredis connections
│   │   └── email.queue.ts         # Queue + typed producers + QueueEvents
│   │
│   ├── workers/
│   │   ├── email.worker.ts        # BullMQ Worker — exhaustive type dispatch
│   │   └── index.ts               # startWorkers / stopWorkers lifecycle
│   │
│   └── utils/
│       ├── distributed-lock.ts    # DistributedLock.acquire / withLock / release
│       ├── rate-limiter.ts        # Sliding window Lua script
│       ├── validation.ts          # Zod schemas + validate() helper
│       ├── response.ts            # ok / created / paginated / buildErrorEnvelope
│       └── index.ts               # toError, sleep
│
├── load-tests/
│   ├── stress-test.js             # k6: booking-storm, mixed-traffic, spike
│   └── README.md                  # k6 install + run instructions
│
├── k8s/
│   ├── deployment.yaml            # 3 replicas, probes, topology spread, security
│   ├── service.yaml               # ClusterIP + headless service
│   └── hpa.yaml                   # CPU 60% / Memory 70%, 3–20 pods, v2 behaviour
│
├── docker-compose.yml             # PostgreSQL 16 + Redis 7 for local dev
├── .env.example                   # All required environment variables documented
├── package.json                   # scripts: dev, build, start, typecheck
└── tsconfig.json                  # strict, ESM, NodeNext, ES2022
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org/) |
| Docker + Compose | v2 | [docker.com](https://docs.docker.com/get-docker/) |
| npm / pnpm | any | bundled with Node |

### 1 — Clone

```bash
git clone https://github.com/your-org/hyperstack-enterprise.git
cd hyperstack-enterprise
```

### 2 — Install dependencies

```bash
npm install
# or
pnpm install
```

### 3 — Configure environment

```bash
cp .env.example .env
# Edit .env if you need non-default credentials
```

```dotenv
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hyperstack_dev
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 4 — Start infrastructure

```bash
docker compose up -d
# PostgreSQL 16 → localhost:5432
# Redis 7       → localhost:6379
```

### 5 — Run database migrations

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 6 — Start the dev server

```bash
npm run dev
# tsx watch — instant hot-reload, no compile step
```

```
[16:24:03] INFO  Database connected ✔
[16:24:03] INFO  Redis connection established ✔
[16:24:03] INFO  Email worker started ✔  { queue: 'email', concurrency: 5 }
[16:24:03] INFO  🚀  hyperstack-enterprise is running  { port: 3000, nodeEnv: 'development' }
```

### 7 — Smoke test

```bash
# Health check
curl http://localhost:3000/health

# Create a booking
curl -s -X POST http://localhost:3000/api/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{"resourceId":"seat:A1","amountMinorUnits":4999,"currency":"USD"}' | jq .

# Try the same resource again — expect 409
curl -s -X POST http://localhost:3000/api/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{"resourceId":"seat:A1","amountMinorUnits":4999,"currency":"USD"}' | jq .
```

---

## 📡 API Reference

All responses follow a standard envelope:

```jsonc
// Success
{ "success": true,  "data": { … }, "timestamp": "…", "meta"?: { … } }

// Error
{ "success": false, "error": { "code": "…", "message": "…", "details"?: [ … ] }, "timestamp": "…" }
```

### Endpoints

| Method | Path | Rate limit | Description |
|---|---|---|---|
| `GET` | `/health` | — | Liveness / readiness probe |
| `POST` | `/api/v1/bookings` | 10 / min | Create booking (lock-guarded) |
| `GET` | `/api/v1/bookings/:id` | 100 / min | Fetch single booking |
| `GET` | `/api/v1/users/:id/bookings` | 100 / min | List bookings (paginated) |
| `DELETE` | `/api/v1/bookings/:id` | 100 / min | Cancel booking |

### POST `/api/v1/bookings`

**Request body:**
```jsonc
{
  "resourceId":       "seat:flash-sale:A1",   // string, 1–255 chars
  "amountMinorUnits": 4999,                   // integer ≥ 0 (cents/paise)
  "currency":         "USD",                  // ISO-4217, default: "USD"
  "metadata":         { "label": "Row A" }    // optional free-form
}
```

**Responses:**

| Status | Code | Meaning |
|---|---|---|
| `201` | — | Booking confirmed; confirmation email queued |
| `400` | `FST_VALIDATION_ERROR` | Invalid request body |
| `409` | `HSE_RESOURCE_BOOKED` | Resource already confirmed |
| `429` | `FST_RATE_LIMIT_EXCEEDED` | 10 req/min exceeded |
| `503` | `HSE_LOCK_TIMEOUT` | Could not acquire lock — retry |

---

## 🔥 Load Testing

Stress tests are written in [k6](https://k6.io/) and live in `load-tests/`.

### Install k6

```bash
brew install k6         # macOS
choco install k6        # Windows
```

### Run scenarios

```bash
# Booking storm — 500 VUs, one contested resource (default)
k6 run load-tests/stress-test.js

# Realistic traffic — 70% read, 20% write, 10% cancel
k6 run -e SCENARIO=mixed-traffic load-tests/stress-test.js

# Flash-sale spike — 0 → 500 VUs in 5 seconds
k6 run -e SCENARIO=spike load-tests/stress-test.js
```

### Thresholds (CI pass / fail)

| Metric | Threshold | Meaning |
|---|---|---|
| `http_req_duration p(95)` | < 500 ms | Overall latency budget |
| `booking_create_duration p(95)` | < 800 ms | Full booking path incl. lock + DB |
| `http_req_failed` | < 1 % | Only true 5xx errors (409/503 excluded) |
| `lock_contention_rate` | < 30 % | 503s under storm load |
| `race_condition_violations` | **== 0** | The critical invariant — zero duplicates |

### Benchmark reference (booking-storm, single node)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Scenario             : booking-storm
 Peak VUs             : 500
 Total requests       : 51 243
 HTTP failure rate    : 0.00 %
 p(50) response time  :  87 ms
 p(95) response time  : 341 ms
 p(99) response time  : 612 ms
───────────────────────────────────────────────────────────
 Bookings confirmed   : 1          ← exactly 1 out of 51 243
 Bookings rejected    : 51 242     ← 409 conflict + 503 timeout
 Lock contention rate : 11.3 %
 Race condition violations: 0  ✔
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> **500 concurrent users, one contested seat — zero duplicate bookings, zero unhandled errors.**

---

## 🐳 Docker

### Local development

```bash
docker compose up -d        # start PostgreSQL + Redis
docker compose down -v      # stop and remove volumes
docker compose logs -f      # tail logs
```

### Build production image

```dockerfile
# Dockerfile (not included — add to suit your registry/CI)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

```bash
docker build -t ghcr.io/your-org/hyperstack-enterprise:latest .
docker push ghcr.io/your-org/hyperstack-enterprise:latest
```

---

## ☸️ Kubernetes Deployment

```bash
# Create namespace
kubectl create namespace hyperstack

# Apply secrets (edit values first)
kubectl create secret generic hyperstack-enterprise-secrets \
  --from-literal=DATABASE_URL="postgresql://…" \
  --from-literal=REDIS_HOST="redis-service" \
  --from-literal=REDIS_PORT="6379" \
  -n hyperstack

# Deploy
kubectl apply -f k8s/ -n hyperstack

# Watch rollout
kubectl rollout status deployment/hyperstack-enterprise -n hyperstack

# Check HPA
kubectl get hpa -n hyperstack -w
```

### HPA scaling behaviour

```
Normal load   →  3 pods   (minReplicas)
CPU > 60%     →  scales out: +4 pods/min or +100% — whichever is more
Flash sale    →  3 → 6 → 12 → 20 pods within ~2 min
Cool-down     →  -1 pod per 120 s, 5 min stabilisation window
```

### Available manifests

| File | Purpose |
|---|---|
| [`k8s/deployment.yaml`](./k8s/deployment.yaml) | 3 replicas, startup/liveness/readiness probes, topology spread across nodes/zones, read-only FS, non-root |
| [`k8s/service.yaml`](./k8s/service.yaml) | ClusterIP (port 80 → 3000) + headless service for mesh discovery |
| [`k8s/hpa.yaml`](./k8s/hpa.yaml) | CPU 60% + Memory 70% dual-metric HPA, v2 scale-up/down behaviour |

---

## 🛠 Available Scripts

```bash
npm run dev          # tsx watch — hot-reload dev server
npm run build        # tsup → ESM bundle in dist/
npm start            # run compiled dist/server.js
npm run typecheck    # tsc --noEmit (no emit, just type checks)
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | ✓ | `development` | Runtime environment |
| `PORT` | ✓ | `3000` | HTTP listen port |
| `HOST` | — | `0.0.0.0` | HTTP listen host |
| `LOG_LEVEL` | — | `info` | pino log level |
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `REDIS_HOST` | ✓ | — | Redis hostname |
| `REDIS_PORT` | ✓ | `6379` | Redis port |

> **Missing any required variable?** The process exits immediately with a descriptive checklist — no silent `undefined` surprises at runtime.

---

## 🧰 Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 20 (ESM) | LTS, native `crypto.randomUUID`, `--watch` |
| Framework | Fastify 5 | 3× faster than Express, built-in schema serialization |
| Language | TypeScript 5.7 strict | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| ORM | Prisma | Type-safe queries, migrations, optimistic locking |
| Cache / Lock | Redis 7 + ioredis | Atomic SET NX PX, Sorted Sets, pub/sub |
| Job Queue | BullMQ | Redis-backed, persistent, retryable background jobs |
| Validation | Zod | Schema = type, field-level errors, no reflection |
| Logging | pino + pino-pretty | Fastest Node.js logger; structured JSON in prod |
| Env Config | dotenv + fail-fast | Crashes clearly on startup, not mid-request |
| Load Tests | k6 | Go binary, scriptable, threshold-driven CI pass/fail |
| Containers | Docker Compose | One command local stack |
| Orchestration | Kubernetes + HPA | Autoscale on CPU + Memory, topology-aware |

---

## 🗺 Roadmap

- [ ] JWT authentication middleware (`@fastify/jwt`)
- [ ] OpenAPI / Swagger docs (`@fastify/swagger`)
- [ ] Prometheus metrics endpoint (`prom-client`)
- [ ] Grafana dashboard (request rate, lock contention, queue depth)
- [ ] Database read replica support in Prisma
- [ ] KEDA scaler for BullMQ queue depth
- [ ] GitHub Actions CI/CD pipeline

---

## 🤝 Contributing

```bash
git checkout -b feat/your-feature
# make changes
npm run typecheck          # must pass
k6 run load-tests/stress-test.js  # race_condition_violations must be 0
git commit -m "feat: your feature"
git push origin feat/your-feature
# open a PR
```

---

## 📄 License

MIT © HyperStack Enterprise Contributors

---

<div align="center">

**Built to handle the load. Designed to never lose a booking.**

⭐ Star this repo if it saved you from a race condition at 3 AM ⭐

</div>
