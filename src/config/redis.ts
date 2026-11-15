import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

// ── Singleton guard (survives tsx watch hot-reloads) ─────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined
}

function createRedisClient(): Redis {
  const client = new Redis({
    host: env.redisHost,
    port: env.redisPort,

    // Connection pool / retry behaviour
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,           // connect explicitly via connectRedis()

    // Exponential back-off: 50 ms → 2 s cap, max 10 attempts
    retryStrategy(times: number): number | null {
      if (times > 10) {
        logger.error({ source: 'redis' }, 'Redis retry limit exceeded — giving up')
        return null             // stop retrying
      }
      const delay = Math.min(50 * 2 ** times, 2_000)
      logger.warn({ source: 'redis', attempt: times, delayMs: delay }, 'Redis reconnecting…')
      return delay
    },

    reconnectOnError(err: Error): boolean {
      // Reconnect on READONLY errors (Redis Sentinel / cluster failover)
      return err.message.includes('READONLY')
    },
  })

  client.on('connect',         () => logger.info({ source: 'redis' }, 'Redis connected ✔'))
  client.on('ready',           () => logger.info({ source: 'redis' }, 'Redis ready ✔'))
  client.on('close',           () => logger.warn({ source: 'redis' }, 'Redis connection closed'))
  client.on('reconnecting',    () => logger.warn({ source: 'redis' }, 'Redis reconnecting…'))
  client.on('error', (err: Error) =>
    logger.error({ source: 'redis', err }, 'Redis client error'),
  )

  return client
}

export const redis: Redis = globalThis.__redis ?? createRedisClient()

if (env.isDev) {
  globalThis.__redis = redis
}

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/**
 * Explicitly opens the Redis connection.
 * Call once during server startup before accepting requests.
 */
export async function connectRedis(): Promise<void> {
  try {
    await redis.connect()
    logger.info({ source: 'redis' }, 'Redis connection established ✔')
  } catch (err) {
    logger.error({ source: 'redis', err }, 'Redis connection failed')
    throw err
  }
}

/**
 * Drains the Redis connection cleanly.
 * Call during graceful shutdown after the HTTP server has closed.
 */
export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit()
    logger.info({ source: 'redis' }, 'Redis disconnected ✔')
  } catch (err) {
    logger.error({ source: 'redis', err }, 'Error disconnecting Redis')
    throw err
  }
}
