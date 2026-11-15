/**
 * Shared BullMQ Redis connection factory.
 *
 * BullMQ mandates separate ioredis instances per role — it blocks the
 * connection during BRPOPLPUSH and cannot share with application queries.
 * This factory mints a fresh, correctly-configured connection each time it
 * is called; callers must NOT reuse the main `redis` singleton.
 *
 * BullMQ manages its own reconnection internally, so we set
 * `maxRetriesPerRequest: null` as required by BullMQ's docs.
 */

import Redis from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

export function createBullMQConnection(role: string): Redis {
  const client = new Redis({
    host: env.redisHost,
    port: env.redisPort,
    maxRetriesPerRequest: null,  // required by BullMQ
    enableReadyCheck: false,     // BullMQ handles its own ready check

    retryStrategy(times: number): number | null {
      if (times > 20) return null
      return Math.min(100 * 2 ** times, 5_000)
    },
  })

  client.on('error', (err: Error) =>
    logger.error({ source: 'bullmq-redis', role, err }, 'BullMQ Redis error'),
  )
  client.on('connect', () =>
    logger.debug({ source: 'bullmq-redis', role }, 'BullMQ Redis connected'),
  )

  return client
}

export const bullMQConnection = {
  host: env.redisHost,
  port: env.redisPort,
} as const
