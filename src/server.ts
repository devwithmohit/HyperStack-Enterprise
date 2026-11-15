// ── Bootstrap: env validation must run before anything else ─────────────────
import './config/env.js'

import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { toError } from './utils/index.js'
import type { FastifyInstance } from 'fastify'

// ── Server start ─────────────────────────────────────────────────────────────

async function start(): Promise<FastifyInstance> {
  const app = await buildApp()

  await app.listen({ port: env.port, host: env.host })

  logger.info(
    { port: env.port, host: env.host, nodeEnv: env.nodeEnv },
    `🚀  hyperstack-enterprise is running`,
  )

  return app
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function registerShutdownHandlers(app: FastifyInstance): void {
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received — closing server…')

    try {
      await app.close()
      logger.info({ signal }, 'Server closed cleanly. Goodbye 👋')
      process.exit(0)
    } catch (err) {
      logger.error({ err: toError(err), signal }, 'Error during graceful shutdown')
      process.exit(1)
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT',  () => void shutdown('SIGINT'))
}

// ── Unhandled rejection / exception safety net ───────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — shutting down')
  process.exit(1)
})

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — shutting down')
  process.exit(1)
})

// ── Entry point ──────────────────────────────────────────────────────────────

start()
  .then(registerShutdownHandlers)
  .catch((err) => {
    logger.error({ err: toError(err) }, 'Server failed to start')
    process.exit(1)
  })
