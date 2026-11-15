import Fastify from 'fastify'
import { env } from './config/env.js'
import { redis } from './config/redis.js'
import { healthRoutes } from './routes/health.routes.js'
import { bookingRoutes } from './routes/booking.routes.js'
import { requestLogger } from './middleware/request-logger.js'
import { standardRateLimiter } from './middleware/rate-limiter.js'
import { buildErrorHandler, buildNotFoundHandler } from './middleware/error-handler.js'

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
    // Attach req.id to every log line automatically
    genReqId: (req) =>
      (req.headers['x-request-id'] as string | undefined) ??
      crypto.randomUUID(),
  })

  // ── Global hooks ─────────────────────────────────────────────────────────────
  // Order: logger → rate-limiter (so 429s are logged before rejection)
  app.addHook('onRequest', requestLogger)
  app.addHook('onRequest', standardRateLimiter(redis))

  // ── Error & 404 handlers ─────────────────────────────────────────────────────
  app.setErrorHandler(buildErrorHandler(app))
  app.setNotFoundHandler(buildNotFoundHandler())

  // ── Routes ───────────────────────────────────────────────────────────────────
  await app.register(healthRoutes)
  await app.register(bookingRoutes, { prefix: '/api/v1' })

  // ── Root ─────────────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    await reply.code(200).send({
      success:   true,
      service:   'hyperstack-enterprise',
      timestamp: new Date().toISOString(),
    })
  })

  return app
}
