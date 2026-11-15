import type { FastifyRequest, FastifyReply } from 'fastify'

export interface HealthResponse {
  status: string
  service: string
  timestamp: string
}

export async function healthCheck(
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body: HealthResponse = {
    status: 'ok',
    service: 'hyperstack-enterprise',
    timestamp: new Date().toISOString(),
  }
  await reply.code(200).send(body)
}
