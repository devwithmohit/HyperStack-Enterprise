import Fastify from 'fastify'
import { config } from './config/index.js'
import { healthRoutes } from './routes/health.routes.js'
import { requestLogger } from './middleware/request-logger.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.isDev
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
    disableRequestLogging: true, // We handle it ourselves
  })

  // ── Hooks ───────────────────────────────────────────────────────────────────
  app.addHook('onRequest', requestLogger)

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
