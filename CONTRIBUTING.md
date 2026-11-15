# Contributing to HyperStack Enterprise

First off — thank you. Every bug report, feature idea, and line of code that lands here makes the project better for everyone building high-concurrency systems. We want contributing to feel approachable whether this is your first open-source PR or your hundredth.

Please read this guide before opening an issue or submitting a pull request. It keeps reviews fast and discussions productive.

> [!IMPORTANT]
> By participating in this project you agree to abide by our [Code of Conduct](#code-of-conduct). We are committed to a welcoming, harassment-free environment for everyone.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [I Just Have a Question](#i-just-have-a-question)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)
- [Submitting a Pull Request](#submitting-a-pull-request)
  - [1 · Fork & Clone](#1--fork--clone)
  - [2 · Set Up the Dev Environment](#2--set-up-the-dev-environment)
  - [3 · Create a Feature Branch](#3--create-a-feature-branch)
  - [4 · Write Your Code](#4--write-your-code)
  - [5 · Commit With Conventional Commits](#5--commit-with-conventional-commits)
  - [6 · Open the Pull Request](#6--open-the-pull-request)
- [Development Guidelines](#development-guidelines)
  - [TypeScript Strict Mode](#typescript-strict-mode)
  - [Concurrency & Redis Locks](#concurrency--redis-locks)
  - [Error Handling Contract](#error-handling-contract)
  - [API Response Shape](#api-response-shape)
  - [Testing & Load Testing](#testing--load-testing)
  - [Logging Standards](#logging-standards)
  - [Environment Variables](#environment-variables)
- [Project Layout Quick Reference](#project-layout-quick-reference)
- [Maintainer Merge Checklist](#maintainer-merge-checklist)

---

## Code of Conduct

This project follows the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

**In short:** be kind, be constructive, assume good faith. Harassment, discrimination, or personal attacks of any kind will not be tolerated and will result in immediate removal from the project.

To report a violation, e-mail **conduct@hyperstack.dev** (or open a private security advisory on GitHub). All reports are handled confidentially.

---

## I Just Have a Question

Before opening an issue, please check:

1. The [README](./README.md) — especially the Quick Start and API Reference sections.
2. [Open and closed issues](../../issues?q=is%3Aissue) — your question may already be answered.
3. The [`load-tests/README.md`](./load-tests/README.md) for k6-specific questions.

If you're still stuck, open a **Discussion** (not an Issue) in the [GitHub Discussions tab](../../discussions). Issues are reserved for confirmed bugs and actionable feature requests.

---

## Reporting Bugs

A great bug report lets a maintainer reproduce the problem in under five minutes. Use the template below when opening an issue.

### Before you file

- [ ] Search existing issues — is this already reported or fixed on `main`?
- [ ] Pull the latest `main` and reproduce — it may already be fixed.
- [ ] Check whether the issue is in your environment (wrong `.env`, outdated Docker image, etc.).

### Bug report template

```
**Title:** [Bug] Short, specific description — e.g. "POST /bookings returns 500 when Redis is unreachable"

**Describe the bug**
A clear, one-paragraph description of what went wrong.

**Reproduction steps**
1. Start infrastructure: `docker compose up -d`
2. Run: `npm run dev`
3. Execute: `curl -X POST http://localhost:3000/api/v1/bookings -d '{"resourceId":"seat:A1","amountMinorUnits":100,"currency":"USD"}'`
4. See error

**Expected behaviour**
What you expected to happen.

**Actual behaviour**
What actually happened. Include the full JSON error response body.

**Logs**
```
paste relevant pino log lines here (redact credentials)
```

**Environment**
- OS: macOS 14.3 / Ubuntu 22.04 / Windows 11
- Node.js: `node --version`
- npm/pnpm: `npm --version`
- Docker: `docker --version`
- Redis: `docker exec hyperstack_redis redis-server --version`
- PostgreSQL: `docker exec hyperstack_postgres psql --version`
- Branch/commit: `git rev-parse --short HEAD`

**Additional context**
Anything else — screenshots, related issues, partial fixes you tried.
```

> [!TIP]
> The more precise the reproduction steps, the faster the fix. If you can link to a minimal repository that reproduces the issue, that's even better.

---

## Suggesting Enhancements

Feature requests are welcome. We prioritise features that align with the project's core mission: **high-concurrency correctness, observability, and production readiness**.

### Before you file

- [ ] Check the [Roadmap](./README.md#️-roadmap) — it may already be planned.
- [ ] Search open issues for a similar suggestion.
- [ ] Consider whether this belongs in a downstream application rather than the framework itself.

### Enhancement request template

```
**Title:** [Feature] Short description — e.g. "Add KEDA scaler for BullMQ queue depth"

**Problem / motivation**
What problem does this solve? Who is affected? Why does the current approach fall short?

**Proposed solution**
How would you implement it? Be as specific as you can — API shape, file locations,
configuration options, etc.

**Alternatives considered**
What other approaches did you evaluate and why did you rule them out?

**Additional context**
Links to relevant docs, prior art, benchmarks, or related issues.
```

Feature requests that include a proof-of-concept branch get reviewed first.

---

## Submitting a Pull Request

### 1 · Fork & Clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/hyperstack-enterprise.git
cd hyperstack-enterprise

# Add the upstream remote so you can keep your fork current
git remote add upstream https://github.com/your-org/hyperstack-enterprise.git
git fetch upstream
```

### 2 · Set Up the Dev Environment

**Prerequisites:**

| Tool | Min version | Install |
|---|---|---|
| Node.js | 20 LTS | [nodejs.org](https://nodejs.org/) |
| Docker + Compose v2 | latest | [docker.com](https://docs.docker.com/get-docker/) |
| k6 | latest | `brew install k6` / `choco install k6` |

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# No changes needed for local dev — defaults work with docker compose

# Start infrastructure (PostgreSQL 16 + Redis 7)
docker compose up -d

# Run database migrations
npx prisma migrate dev --name init
npx prisma generate

# Start the dev server (hot-reload via tsx watch)
npm run dev
```

Verify everything is healthy:

```bash
curl http://localhost:3000/health
# → { "success": true, "data": { "status": "ok", … } }
```

### 3 · Create a Feature Branch

Always branch from the latest `main`:

```bash
git checkout main
git pull upstream main

git checkout -b <type>/<short-description>
```

**Branch naming convention:**

| Type | Example |
|---|---|
| `feat/` | `feat/jwt-authentication` |
| `fix/` | `fix/lock-release-on-timeout` |
| `docs/` | `docs/update-k6-readme` |
| `refactor/` | `refactor/booking-service-extract` |
| `chore/` | `chore/upgrade-fastify-5` |
| `perf/` | `perf/reduce-redis-round-trips` |
| `test/` | `test/k6-mixed-traffic-scenario` |

### 4 · Write Your Code

Follow the [Development Guidelines](#development-guidelines) below. Key rules:

- **Never** introduce a code path that bypasses the distributed lock for concurrent resource writes.
- **Never** add a raw `reply.send({ success: true, … })` in a controller — use `ok()`, `created()`, or `paginated()` from `src/utils/response.ts`.
- **Never** `throw new Error(…)` in a service — throw a typed `createError(…)` instance so the error handler can classify it correctly.
- Keep files focused: routes register paths and schemas, controllers validate + delegate, services own business logic, utils are pure and stateless.

Run the type-checker before committing:

```bash
npm run typecheck   # must exit 0
```

### 5 · Commit With Conventional Commits

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification. This keeps the changelog automated and makes `git bisect` usable.

**Format:**

```
<type>(<optional scope>): <imperative, present-tense summary>

[optional body — explain WHY, not WHAT]

[optional footer — breaking changes, issue refs]
```

**Types:**

| Type | When to use |
|---|---|
| `feat` | A new user-facing feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace — no logic change |
| `refactor` | Code restructure with no behaviour change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests / load scripts |
| `chore` | Dependency updates, build tooling, CI config |
| `revert` | Reverting a previous commit |

**Good examples:**

```
feat(booking): add optimistic-lock version check on cancel

Prevents a concurrent update from silently overwriting a cancellation
when two requests arrive within the same millisecond.

Closes #42
```

```
fix(rate-limiter): fail open when Redis eval throws NOSCRIPT

The Lua script was occasionally evicted from the Redis script cache
under memory pressure. We now catch NOSCRIPT and re-send EVALSHA.

Fixes #87
```

```
perf(distributed-lock): reduce default retry delay from 100 ms to 80 ms

load-tests/stress-test.js p95 drops from 480 ms → 341 ms on the
booking-storm scenario with 500 VUs at peak.
```

**Breaking changes** must include a `BREAKING CHANGE:` footer:

```
feat(env)!: require REDIS_SENTINEL_HOST when REDIS_MODE=sentinel

BREAKING CHANGE: existing deployments using standalone Redis must
set REDIS_MODE=standalone in their environment to suppress the new
sentinel validation error.
```

> [!NOTE]
> Commits that don't follow this format will be squashed by a maintainer during merge. Help us keep history clean by using the convention from the start.

### 6 · Open the Pull Request

```bash
git push origin feat/your-feature
```

Then open a PR on GitHub against `main`. Use this template:

```markdown
## Summary
<!-- One paragraph: what does this PR do and why? -->

## Type of change
- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Documentation update
- [ ] Refactor / perf improvement

## Changes
<!-- Bullet list of concrete changes -->
- Added `src/middleware/jwt.ts` with Fastify JWT plugin integration
- Updated `src/app.ts` to register the JWT plugin globally
- Added `jwtSecret` to env validation schema

## Testing
<!-- How did you verify correctness? -->
- [ ] `npm run typecheck` passes
- [ ] k6 booking-storm scenario: `race_condition_violations == 0`
- [ ] Manual curl smoke tests (paste output)

## Checklist
- [ ] My branch is up to date with `upstream/main`
- [ ] I followed the TypeScript strict mode guidelines
- [ ] New env variables are added to `.env.example` with comments
- [ ] New routes use `ok()` / `created()` / `paginated()` response helpers
- [ ] Any new Redis operations use a dedicated connection (not the app singleton) if blocking
- [ ] No `console.log` — structured pino logging only

## Related issues
Closes #<number>
```

---

## Development Guidelines

### TypeScript Strict Mode

The `tsconfig.json` enables every strict flag. These are **non-negotiable** — the type-checker is your first line of defence against concurrency bugs.

```jsonc
// tsconfig.json (excerpted)
{
  "strict":                       true,
  "noImplicitAny":                true,
  "noImplicitReturns":            true,
  "noUncheckedIndexedAccess":     true,   // arr[0] is T | undefined, not T
  "exactOptionalPropertyTypes":   true,   // { x?: string } ≠ { x: string | undefined }
  "noFallthroughCasesInSwitch":   true
}
```

**Patterns that will block your PR:**

```typescript
// ❌ Type assertion without a guard
const booking = result as Booking

// ✅ Narrow the type properly
if (!result) throw new BookingNotFoundError(id)
const booking: Booking = result

// ❌ Silently swallow unknown error
} catch (e) { console.error(e) }

// ✅ Use the toError() utility and log structured
} catch (err) { logger.error({ err: toError(err) }, 'Operation failed') }

// ❌ Non-exhaustive switch (TypeScript won't catch this without never)
switch (job.data.type) {
  case 'welcome': …
  case 'password-reset': …
  // new 'notification' type added but forgotten here
}

// ✅ Exhaustive switch with never guard
default: {
  const _exhaustive: never = job.data
  logger.error({ data: job.data }, 'Unknown job type')
  void _exhaustive
}
```

---

### Concurrency & Redis Locks

This is the most critical section. HyperStack's correctness guarantee — **zero duplicate bookings** — depends on every contributor following these rules.

#### Rule 1 — Use `DistributedLock.withLock()` for contested resource writes

Any write that must be unique per resource must run inside `DistributedLock.withLock()`:

```typescript
// ✅ Correct — the lock guards the check AND the write atomically
await DistributedLock.withLock(redis, `booking:resource:${resourceId}`, async () => {
  const existing = await db.booking.findFirst({ where: { resourceId, status: 'CONFIRMED' } })
  if (existing) throw new ResourceAlreadyBookedError(resourceId)
  return db.booking.create({ data: { … } })
}, { ttlMs: 5_000, retryTimeoutMs: 3_000 })

// ❌ Wrong — gap between the check and the write lets two requests both "win"
const existing = await db.booking.findFirst(…)
if (!existing) await db.booking.create(…)   // race condition!
```

#### Rule 2 — Never share the BullMQ ioredis connection

BullMQ uses `BRPOPLPUSH` which blocks the connection. It **must** use its own connection minted by `createBullMQConnection()`:

```typescript
// ✅ Correct — dedicated connection per BullMQ role
const worker = new Worker(queueName, processor, {
  connection: bullMQConnection,   // from src/queues/bullmq-connection.ts
})

// ❌ Wrong — will block all application Redis commands
const worker = new Worker(queueName, processor, {
  connection: redis,  // the shared app singleton
})
```

#### Rule 3 — Use `maxRetriesPerRequest: null` for BullMQ connections only

```typescript
// ✅ BullMQ connection — blocking commands need unlimited retries
new Redis({ maxRetriesPerRequest: null })

// ✅ App Redis singleton — bounded retries prevent hanging requests
new Redis({ maxRetriesPerRequest: 3 })
```

#### Rule 4 — Release locks in `finally`, always

If you use the low-level `DistributedLock.acquire()` API instead of `withLock()`, the lock **must** be released in a `finally` block:

```typescript
const lock = await DistributedLock.acquire(redis, key)
try {
  await doWork()
} finally {
  await lock.release()   // runs even if doWork() throws
}
```

#### Rule 5 — Validate lock invariants in k6

After any change touching the booking flow, run the booking-storm scenario and confirm the invariant holds:

```bash
k6 run load-tests/stress-test.js
# race_condition_violations must be 0
```

A PR that makes `race_condition_violations > 0` will not be merged, regardless of other quality.

---

### Error Handling Contract

All application errors must be instances created with `@fastify/error`'s `createError()`. The global error handler in `src/middleware/error-handler.ts` classifies errors by their `statusCode` and `code` fields.

```typescript
// ✅ Typed domain error — classified correctly by the error handler
import { createError } from '@fastify/error'

export const MyDomainError = createError(
  'HSE_MY_ERROR',      // code — prefix with HSE_ for domain errors
  'Resource %s failed: %s',
  422,                 // HTTP status code
)

throw new MyDomainError(resourceId, reason)

// ❌ Plain Error — loses status code, becomes 500
throw new Error('something went wrong')

// ❌ Manual reply.send() inside a service — bypasses the error handler
await reply.code(422).send({ success: false, error: 'nope' })
```

**Error code namespace:**

| Prefix | Owner | Examples |
|---|---|---|
| `HSE_` | Domain / business logic | `HSE_RESOURCE_BOOKED`, `HSE_BOOKING_NOT_FOUND` |
| `FST_` | Fastify built-ins | `FST_ERR_VALIDATION`, `FST_RATE_LIMIT_EXCEEDED` |
| `PRISMA_` | Injected by error handler | `PRISMA_P2002`, `PRISMA_P2025` |

---

### API Response Shape

Every HTTP response must use the standard envelope from `src/utils/response.ts`. Never construct the envelope manually in a controller.

```typescript
import { ok, created, paginated, noContent } from '../utils/response.js'

// Single resource
await ok(reply, booking)
await ok(reply, booking, { message: 'Booking retrieved' })

// Created
await created(reply, booking, 'Booking confirmed')

// Collection with pagination
await paginated(reply, bookings, { total, limit, offset })

// Empty response
await noContent(reply)
```

Errors are **never** sent from controllers. Throw and let `src/middleware/error-handler.ts` handle it.

---

### Testing & Load Testing

HyperStack does not yet have a unit/integration test suite (see [Roadmap](./README.md#️-roadmap)). Until one is added, the **primary correctness gate is the k6 load test**.

**Before every PR:**

```bash
# 1. Type check
npm run typecheck

# 2. Start the full stack
docker compose up -d
npm run dev &

# 3. Run the booking-storm scenario
k6 run load-tests/stress-test.js

# Required output: race_condition_violations: 0
# Soft targets: p(95) < 500 ms, http_req_failed < 1%
```

**When adding a new concurrent endpoint:**

1. Add a new scenario or extend `mixedTraffic()` in `load-tests/stress-test.js`.
2. Add a custom metric if the endpoint has concurrency semantics.
3. Document the expected contention behaviour in a comment block.

**When changing the distributed lock parameters** (`ttlMs`, `retryTimeoutMs`, `retryDelayMs`):

- Run the spike scenario (`-e SCENARIO=spike`) and confirm p95 stays within thresholds.
- Include before/after benchmark numbers in the PR description.

---

### Logging Standards

We use [pino](https://getpino.io/) for structured logging. No `console.log` anywhere in production code.

```typescript
// ✅ Structured — machine-parseable, correlated by reqId
logger.info({ bookingId, userId, resourceId }, 'Booking created ✔')
logger.warn({ key, attempt, waitMs }, 'Lock busy — retrying…')
logger.error({ err: toError(err), jobId }, 'Email job failed')

// ❌ Unstructured — not searchable in Grafana/Loki
console.log('Booking created: ' + bookingId)
logger.info('Booking ' + bookingId + ' created for user ' + userId)
```

**Log level policy:**

| Level | When to use |
|---|---|
| `trace` | Extremely verbose — individual Lua eval results, per-retry detail |
| `debug` | Lock acquire/release, rate-limit check pass, job start |
| `info` | Successful business operations, server start/stop |
| `warn` | Expected degradation: Redis reconnect, rate-limit exceeded, lock retry |
| `error` | Unexpected failures requiring human attention |
| `fatal` | Reserved for process-level failures before `process.exit(1)` |

---

### Environment Variables

Any PR that introduces a new environment variable must:

1. Add the variable to `src/config/env.ts` with a clear `description` string.
2. Add it to `.env.example` with a safe default value and a comment.
3. Mark it `required: true` and omit `fallback` if the application cannot start without it.

```typescript
// src/config/env.ts — add to schema array
{
  key:         'SMTP_HOST',
  required:    true,
  description: 'SMTP relay hostname for transactional emails (e.g. smtp.sendgrid.net)',
},
```

```dotenv
# .env.example
# ── Email (SMTP) ──────────────────────────────────────────────────────────────
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

---

## Project Layout Quick Reference

```
src/
├── config/        env, logger, database (Prisma), redis (ioredis) — infrastructure singletons
├── middleware/    error-handler, rate-limiter, request-logger — Fastify hooks
├── routes/        path + JSON schema registration only — no business logic
├── controllers/   validate input → call one service function → send response helper
├── services/      business logic, lock usage, Prisma transactions, queue enqueue
├── queues/        BullMQ Queue + typed producers + QueueEvents
├── workers/       BullMQ Worker processors + lifecycle helpers
└── utils/         pure helpers: distributed-lock, validation, response, index
```

**Dependency direction (strict, no cycles):**

```
routes → controllers → services → utils
                     → config (db, redis, logger)
                     → queues
workers → queues → config
middleware → config
```

If you find yourself importing a `controller` from a `service`, or a `route` from a `controller`, stop — you have a cycle. Restructure before opening the PR.

---

## Maintainer Merge Checklist

Maintainers verify the following before merging any PR:

- [ ] `npm run typecheck` exits 0 on the PR branch
- [ ] k6 booking-storm: `race_condition_violations == 0`
- [ ] k6 booking-storm: `http_req_failed < 1 %`
- [ ] No new `console.log` statements introduced
- [ ] New env vars present in both `env.ts` schema and `.env.example`
- [ ] New routes use response helpers, not raw `reply.send()`
- [ ] New services throw typed `createError()` errors, not plain `Error`
- [ ] Any new Redis blocking operation uses `createBullMQConnection()`, not the app singleton
- [ ] PR description contains before/after metrics for perf PRs
- [ ] Conventional commit format on all commits (or squash message is formatted correctly)
- [ ] `BREAKING CHANGE` footer present for any breaking change
- [ ] Related issue linked in PR description

---

*Thank you for making HyperStack Enterprise better. We review PRs within 48 hours on business days. If you haven't heard back in 72 hours, feel free to ping in the PR thread.*
