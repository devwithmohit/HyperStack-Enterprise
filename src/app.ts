import Fastify from 'fastify'
import { env } from './config/env.js'
import { redis } from './config/redis.js'
import { healthRoutes } from './routes/health.routes.js'
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
    // Fastify sets X-Forwarded-For automatically when behind a proxy.
    // Set to the number of trusted proxy hops in production.
    trustProxy: env.isDev ? false : 1,
    disableRequestLogging: true, // We handle it ourselves
  })

  // ── Hooks ───────────────────────────────────────────────────────────────────
  // Order matters: logger first so every request is traced, rate-limiter
  // second so 429s are still logged before being rejected.
  app.addHook('onRequest', requestLogger)
  app.addHook('onRequest', standardRateLimiter(redis))

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(healthRoutes)

  // ── Root ────────────────────────────────────────────────────────────────────
  app.get('/', async (_req, reply) => {
    await reply.code(200).send({
      status: 'ok',
      service: 'hyperstack-enterprise',
      timestamp: new Date().toISOString(),
    })
  })

  return app
}
