import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify'

/**
 * Adds a unique request-id to every incoming request's log context.
 * Fastify already generates req.id automatically; this hook surfaces it.
 */
export function requestLogger(
  req: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  req.log.info({ url: req.url, method: req.method }, 'incoming request')
  done()
}
