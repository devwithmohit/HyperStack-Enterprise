import type { FastifyRequest, FastifyReply } from 'fastify'
import { ok } from '../utils/response.js'

export async function healthCheck(
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await ok(reply, {
    status:    'ok',
    service:   'hyperstack-enterprise',
    timestamp: new Date().toISOString(),
  })
}
