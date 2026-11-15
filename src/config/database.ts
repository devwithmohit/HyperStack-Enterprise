import { PrismaClient } from '@prisma/client'
import { logger } from './logger.js'
import { env } from './env.js'

// ── Singleton pattern ─────────────────────────────────────────────────────────
// In development, `tsx watch` re-evaluates modules on every file change.
// Without this guard a new PrismaClient (and connection pool) would be
// created on every hot-reload, quickly exhausting PostgreSQL connections.
//
// We stash the instance on the Node.js global object — it survives HMR
// but is never present in production where this module loads exactly once.

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const logLevels: Array<'query' | 'info' | 'warn' | 'error'> = env.isDev
    ? ['warn', 'error']   // add 'query' here to trace every SQL statement
    : ['warn', 'error']

  return new PrismaClient({
    log: logLevels.map((level) => ({ emit: 'event', level })),
    errorFormat: env.isDev ? 'pretty' : 'minimal',
  })
}

// ── Build or reuse the singleton ─────────────────────────────────────────────

export const db: PrismaClient =
  globalThis.__prisma ?? createPrismaClient()

if (env.isDev) {
  globalThis.__prisma = db
}

// ── Wire pino to Prisma log events ───────────────────────────────────────────

db.$on('warn', (e) => logger.warn({ source: 'prisma', message: e.message }, 'Prisma warning'))
db.$on('error', (e) => logger.error({ source: 'prisma', message: e.message }, 'Prisma error'))

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/**
 * Opens the connection pool.
 * Call once during server startup before accepting requests.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await db.$connect()
    logger.info({ source: 'prisma' }, 'Database connected ✔')
  } catch (err) {
    logger.error({ source: 'prisma', err }, 'Database connection failed')
    throw err
  }
}

/**
 * Drains the connection pool.
 * Call during graceful shutdown after the HTTP server has closed.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await db.$disconnect()
    logger.info({ source: 'prisma' }, 'Database disconnected ✔')
  } catch (err) {
    logger.error({ source: 'prisma', err }, 'Error disconnecting database')
    throw err
  }
}
