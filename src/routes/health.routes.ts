import type { FastifyInstance } from 'fastify'
import { healthCheck } from '../controllers/health.controller.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', {
    schema: {
      tags: ['System'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    handler: healthCheck,
  })
}
