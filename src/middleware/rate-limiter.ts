/**
 * Sliding Window Rate Limiter — Redis ZSET implementation.
 *
 * Algorithm:
 *   Each unique client (by IP or user ID) owns a Redis Sorted Set keyed as:
 *     rl:<identifier>
 *
 *   Every request inserts its arrival timestamp (ms) as both score AND member
 *   (member uniqueness is preserved by appending a random suffix so burst
 *   requests within the same millisecond are all counted separately).
 *
 *   Before counting, stale entries outside the current window are pruned with
 *   ZREMRANGEBYSCORE.  ZCARD then gives the exact request count in O(log N).
 *
 *   All four Redis operations run inside a single pipeline (atomic batch),
 *   making the check-and-count effectively a single round-trip.
 *
 * Headers emitted on every response:
 *   X-RateLimit-Limit     — max requests allowed in the window
 *   X-RateLimit-Remaining — requests still available in this window
 *   X-RateLimit-Reset     — Unix epoch (seconds) when the window resets
 *   Retry-After           — seconds to wait (only on 429)
 */

import { randomBytes } from 'node:crypto'
import { createError } from '@fastify/error'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type Redis from 'ioredis'
import { logger } from '../config/logger.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /** Redis client instance. */
  redis: Redis

  /**
   * Maximum number of requests allowed within `windowMs`.
   * @default 100
   */
  limit?: number

  /**
   * Rolling window size in milliseconds.
   * @default 60_000 (1 minute)
   */
  windowMs?: number

  /**
   * Derive the client identifier from the request.
   * Defaults to `req.ip`.  For authenticated routes pass `req.user.id`.
   */
  keyGenerator?: (req: FastifyRequest) => string

  /**
   * Optional prefix for the Redis key.
   * @default "rl:"
   */
  keyPrefix?: string

  /**
   * Routes to skip entirely (exact path match).
   * e.g. ['/health', '/metrics']
   */
  skip?: string[]
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: number   // Unix epoch seconds
  retryAfter: number // seconds until window resets (only meaningful when exceeded)
}

// ── Errors ────────────────────────────────────────────────────────────────────

const TooManyRequestsError = createError(
  'FST_RATE_LIMIT_EXCEEDED',
  'Too Many Requests — rate limit exceeded. Retry after %d seconds.',
  429,
)

// ── Lua pipeline script ───────────────────────────────────────────────────────
//
// Runs atomically on Redis:
//   1. ZREMRANGEBYSCORE  — evict entries older than the window
//   2. ZADD              — record this request
//   3. ZCARD             — count requests in window
//   4. PEXPIRE           — keep the key alive for exactly one more window
//
// Using eval() makes steps 1-4 a single atomic unit; no other command
// can interleave between the prune and the count.

const SLIDING_WINDOW_SCRIPT = `
  local key        = KEYS[1]
  local now        = tonumber(ARGV[1])
  local windowMs   = tonumber(ARGV[2])
  local member     = ARGV[3]
  local windowStart = now - windowMs

  redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)
  redis.call("ZADD", key, now, member)
  local count = redis.call("ZCARD", key)
  redis.call("PEXPIRE", key, windowMs)

  return count
` as const

// ── Core counter ──────────────────────────────────────────────────────────────

async function incrementWindow(
  client: Redis,
  key: string,
  nowMs: number,
  windowMs: number,
): Promise<number> {
  // Append random 8-hex-char suffix so two requests in the same ms are
  // stored as distinct ZSET members and both get counted.
  const member = `${nowMs}:${randomBytes(4).toString('hex')}`

  const count = await client.eval(
    SLIDING_WINDOW_SCRIPT,
    1,       // numkeys
    key,     // KEYS[1]
    String(nowMs),
    String(windowMs),
    member,  // ARGV[3]
  ) as number

  return count
}

// ── Header helpers ────────────────────────────────────────────────────────────

function setRateLimitHeaders(
  reply: FastifyReply,
  info: RateLimitInfo,
): void {
  reply
    .header('X-RateLimit-Limit',     String(info.limit))
    .header('X-RateLimit-Remaining', String(Math.max(0, info.remaining)))
    .header('X-RateLimit-Reset',     String(info.resetAt))
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns a Fastify `onRequest` hook implementing a Redis-backed
 * sliding-window rate limiter.
 *
 * @example
 * // Global — applied to all routes
 * app.addHook('onRequest', createRateLimiter({ redis, limit: 100, windowMs: 60_000 }))
 *
 * @example
 * // Route-scoped — stricter limit for a sensitive endpoint
 * app.post('/bookings', {
 *   onRequest: createRateLimiter({ redis, limit: 10, windowMs: 60_000 }),
 *   handler: bookingHandler,
 * })
 */
export function createRateLimiter(opts: RateLimiterOptions) {
  const {
    redis,
    limit       = 100,
    windowMs    = 60_000,
    keyGenerator = (req) => req.ip ?? 'unknown',
    keyPrefix   = 'rl:',
    skip        = [],
  } = opts

  const windowSeconds = Math.ceil(windowMs / 1_000)

  return async function rateLimiterHook(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // ── Skip list ──────────────────────────────────────────────────────────
    if (skip.includes(req.url)) return

    const identifier = keyGenerator(req)
    const key        = `${keyPrefix}${identifier}`
    const nowMs      = Date.now()

    // Window resets `windowMs` from the first request in the current window.
    // We approximate it as `windowMs` from now for the Reset header value —
    // this is a safe, conservative upper-bound.
    const resetAt = Math.ceil((nowMs + windowMs) / 1_000)

    let count: number

    try {
      count = await incrementWindow(redis, key, nowMs, windowMs)
    } catch (err) {
      // Redis unavailable — fail open (do NOT block traffic) but log loudly.
      logger.error(
        { err, key, identifier },
        'Rate limiter Redis error — failing open',
      )
      return
    }

    const remaining = limit - count

    const info: RateLimitInfo = {
      limit,
      remaining,
      resetAt,
      retryAfter: windowSeconds,
    }

    // ── Always set informational headers ──────────────────────────────────
    setRateLimitHeaders(reply, info)

    // ── Enforce limit ──────────────────────────────────────────────────────
    if (count > limit) {
      logger.warn(
        { identifier, count, limit, windowMs },
        'Rate limit exceeded',
      )

      reply.header('Retry-After', String(windowSeconds))

      throw new TooManyRequestsError(windowSeconds)
    }

    logger.debug(
      { identifier, count, limit, remaining },
      'Rate limit check passed',
    )
  }
}

// ── Named preset factories ────────────────────────────────────────────────────

/**
 * Strict limiter for sensitive / write endpoints (e.g. /bookings, /checkout).
 * 10 requests per minute per IP.
 */
export function strictRateLimiter(redis: Redis) {
  return createRateLimiter({ redis, limit: 10, windowMs: 60_000 })
}

/**
 * Standard API limiter for general authenticated routes.
 * 100 requests per minute per user/IP.
 */
export function standardRateLimiter(redis: Redis) {
  return createRateLimiter({
    redis,
    limit: 100,
    windowMs: 60_000,
    skip: ['/health'],
  })
}

/**
 * Generous limiter for public read-only routes.
 * 300 requests per minute per IP.
 */
export function publicRateLimiter(redis: Redis) {
  return createRateLimiter({
    redis,
    limit: 300,
    windowMs: 60_000,
    skip: ['/health'],
  })
}
