/**
 * Distributed Lock — Redis-backed, Redlock-inspired implementation.
 *
 * Guarantees:
 *  • Mutual exclusion  — only one holder at a time per resource key.
 *  • Deadlock safety   — TTL ensures locks are always released eventually.
 *  • No stale release  — Lua CAS script releases ONLY the token the caller
 *                        originally acquired, preventing accidental eviction
 *                        of a lock owned by a concurrent requester.
 *
 * Usage:
 *   const lock = await DistributedLock.acquire(redis, 'booking:seat:42')
 *   try   { await doWork() }
 *   finally { await lock.release() }
 *
 *   // — or — wrap automatically:
 *   await DistributedLock.withLock(redis, 'booking:seat:42', doWork)
 */

import { randomBytes } from 'node:crypto'
import type Redis from 'ioredis'
import { logger } from '../config/logger.js'
import { sleep } from './index.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCK_KEY_PREFIX = 'dlock:'

/**
 * Lua CAS-release script.
 *
 * Atomically:
 *   if redis.call("GET", key) == token then DELETE key; return 1
 *   else return 0  (someone else owns it — do NOT delete)
 *
 * Running as a Lua script guarantees the GET→DEL is an atomic unit;
 * no other command can interleave between the check and the delete.
 */
const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
` as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LockOptions {
  /** Lock TTL in milliseconds. Default: 10 000 (10 s). */
  ttlMs?: number
  /** Max time to keep retrying before giving up. Default: 5 000 (5 s). */
  retryTimeoutMs?: number
  /** Base delay between retries. Actual delay adds random jitter. Default: 100 ms. */
  retryDelayMs?: number
  /** Maximum jitter added to retryDelayMs. Default: 50 ms. */
  jitterMs?: number
}

export interface LockHandle {
  /** Unique token minted when the lock was acquired. */
  readonly token: string
  /** Fully-qualified Redis key. */
  readonly key: string
  /** Wall-clock time (ms) at which the lock expires on Redis. */
  readonly expiresAt: number
  /** Release the lock. No-ops if already released or expired. */
  release(): Promise<boolean>
}

export class LockNotAcquiredError extends Error {
  constructor(public readonly resourceKey: string, public readonly timeoutMs: number) {
    super(
      `Could not acquire distributed lock on "${resourceKey}" within ${timeoutMs} ms`,
    )
    this.name = 'LockNotAcquiredError'
  }
}

// ── Core implementation ───────────────────────────────────────────────────────

function buildKey(resource: string): string {
  return `${LOCK_KEY_PREFIX}${resource}`
}

function mintToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Attempt a single atomic SET NX PX acquisition.
 * Returns `true` on success, `false` if the key already exists.
 */
async function tryAcquire(
  client: Redis,
  key: string,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  // SET key token NX PX ttlMs
  //   NX  — only set if Not eXists
  //   PX  — expiry in milliseconds
  const result = await client.set(key, token, 'NX', 'PX', ttlMs)
  return result === 'OK'
}

/**
 * Run the Lua CAS-release script.
 * Returns `true` if our token was still the owner and the key was deleted.
 */
async function tryRelease(
  client: Redis,
  key: string,
  token: string,
): Promise<boolean> {
  const result = await client.eval(RELEASE_SCRIPT, 1, key, token) as number
  return result === 1
}

// ── Public API ────────────────────────────────────────────────────────────────

export const DistributedLock = {
  /**
   * Acquire a distributed lock with retry + jitter back-off.
   *
   * @throws {LockNotAcquiredError} if the lock cannot be acquired within
   *   `retryTimeoutMs`.
   */
  async acquire(
    client: Redis,
    resource: string,
    options: LockOptions = {},
  ): Promise<LockHandle> {
    const {
      ttlMs          = 10_000,
      retryTimeoutMs =  5_000,
      retryDelayMs   =    100,
      jitterMs       =     50,
    } = options

    const key   = buildKey(resource)
    const token = mintToken()
    const deadline = Date.now() + retryTimeoutMs

    let attempt = 0

    while (Date.now() < deadline) {
      attempt++
      const acquired = await tryAcquire(client, key, token, ttlMs)

      if (acquired) {
        const expiresAt = Date.now() + ttlMs

        logger.debug(
          { key, token: token.slice(0, 8), ttlMs, attempt },
          'Distributed lock acquired',
        )

        // Build and return the handle
        let released = false

        return {
          token,
          key,
          expiresAt,
          async release(): Promise<boolean> {
            if (released) return false
            released = true

            const ok = await tryRelease(client, key, token)

            logger.debug(
              { key, token: token.slice(0, 8), ok },
              ok ? 'Distributed lock released' : 'Lock release skipped (token mismatch — already expired?)',
            )

            return ok
          },
        }
      }

      // Back-off with full jitter to spread thundering-herd retries
      const jitter = Math.floor(Math.random() * jitterMs)
      const wait   = retryDelayMs + jitter

      logger.debug(
        { key, attempt, waitMs: wait, remainingMs: deadline - Date.now() },
        'Lock busy — retrying…',
      )

      await sleep(wait)
    }

    throw new LockNotAcquiredError(resource, retryTimeoutMs)
  },

  /**
   * Convenience wrapper: acquire → execute callback → release (always).
   *
   * @example
   * const result = await DistributedLock.withLock(
   *   redis, 'booking:seat:42', async () => {
   *     return bookSeat(userId, seatId)
   *   })
   */
  async withLock<T>(
    client: Redis,
    resource: string,
    fn: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<T> {
    const lock = await DistributedLock.acquire(client, resource, options)

    try {
      return await fn()
    } finally {
      await lock.release()
    }
  },

  /**
   * Check whether a lock key is currently held (non-destructive).
   * Useful for observability / health checks — not for decision logic
   * (the answer may be stale by the time you act on it).
   */
  async isLocked(client: Redis, resource: string): Promise<boolean> {
    const exists = await client.exists(buildKey(resource))
    return exists === 1
  },

  /**
   * Return the remaining TTL (ms) of a held lock, or `null` if not locked.
   */
  async remainingTtlMs(client: Redis, resource: string): Promise<number | null> {
    // PTTL returns ms; -2 = key missing, -1 = no expiry (should never happen)
    const pttl = await client.pttl(buildKey(resource))
    return pttl >= 0 ? pttl : null
  },
} as const
