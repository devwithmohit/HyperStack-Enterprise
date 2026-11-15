import Fastify, { type FastifyError } from 'fastify'
import { env } from './config/env.js'
import { redis } from './config/redis.js'
import { healthRoutes } from './routes/health.routes.js'
import { bookingRoutes } from './routes/booking.routes.js'
import { requestLogger } from './middleware/request-logger.js'
import { standardRateLimiter } from './middleware/rate-limiter.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.logLevel,
      ...(env.isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    trustProxy: env.isDev ? false : 1,
    disableRequestLogging: true,
  })

  // ── Global hooks ─────────────────────────────────────────────────────────────
  app.addHook('onRequest', requestLogger)
  app.addHook('onRequest', standardRateLimiter(redis))

  // ── Global error handler ─────────────────────────────────────────────────────
  // Normalises every thrown error (Fastify, Zod, Prisma, domain) into a
  // consistent JSON envelope before it reaches the client.
  app.setErrorHandler(
    async (error: FastifyError, _req, reply) => {
      const statusCode = error.statusCode ?? 500
      const isServer   = statusCode >= 500

      if (isServer) {
        app.log.error({ err: error }, 'Unhandled server error')
      } else {
        app.log.warn({ err: error }, 'Client error')
      }

      await reply.code(statusCode).send({
        statusCode,
        code:    error.code    ?? 'INTERNAL_SERVER_ERROR',
        error:   error.name    ?? 'Error',
        message: isServer && !env.isDev
          ? 'An unexpected error occurred'
          : error.message,
      })
    },
  )

  // ── 404 handler ──────────────────────────────────────────────────────────────
  app.setNotFoundHandler(async (_req, reply) => {
    await reply.code(404).send({
      statusCode: 404,
      code:       'NOT_FOUND',
      error:      'Not Found',
      message:    `Route ${_req.method} ${_req.url} not found`,
    })
  })

  // ── Routes ───────────────────────────────────────────────────────────────────
  await app.register(healthRoutes)
  await app.register(bookingRoutes, { prefix: '/api/v1' })

  // ── Root ─────────────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    await reply.code(200).send({
      status:    'ok',
      service:   'hyperstack-enterprise',
      timestamp: new Date().toISOString(),
    })
  })

  return app
}
