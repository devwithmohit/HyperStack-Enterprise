/**
 * API Response Helpers — standard success and error envelope factories.
 *
 * Every handler that returns data should use `ok()` or `paginated()`.
 * Error responses are produced exclusively by the error handler — never
 * call `fail()` from a controller; throw an error instead and let the
 * handler normalise it.
 *
 * Success envelope:
 *   { success: true, data: T, [meta]: PaginationMeta, [message]: string }
 *
 * Error envelope (produced by error-handler.ts):
 *   { success: false, error: { code, message, [details]: string[] } }
 */

import type { FastifyReply } from 'fastify'

// ── Envelope types ────────────────────────────────────────────────────────────

export interface PaginationMeta {
  total:  number
  limit:  number
  offset: number
  /** Derived convenience fields */
  page:        number
  totalPages:  number
  hasNext:     boolean
  hasPrev:     boolean
}

export interface SuccessEnvelope<T> {
  success:   true
  data:      T
  meta?:     PaginationMeta
  message?:  string
  timestamp: string
}

export interface ErrorDetail {
  field?:   string
  message:  string
}

export interface ErrorEnvelope {
  success: false
  error: {
    code:      string
    message:   string
    details?:  ErrorDetail[]
  }
  timestamp: string
}

export type ApiResponse<T> = SuccessEnvelope<T> | ErrorEnvelope

// ── Pagination helper ─────────────────────────────────────────────────────────

export function buildMeta(total: number, limit: number, offset: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit) || 1
  const page       = Math.floor(offset / limit) + 1

  return {
    total,
    limit,
    offset,
    page,
    totalPages,
    hasNext: offset + limit < total,
    hasPrev: offset > 0,
  }
}

// ── Success response senders ──────────────────────────────────────────────────

/**
 * Send a 200 OK with a standard success envelope.
 *
 * @example
 * return ok(reply, booking)
 * return ok(reply, booking, { message: 'Booking retrieved', statusCode: 200 })
 */
export async function ok<T>(
  reply: FastifyReply,
  data: T,
  opts: { message?: string; statusCode?: number } = {},
): Promise<void> {
  const body: SuccessEnvelope<T> = {
    success:   true,
    data,
    timestamp: new Date().toISOString(),
    ...(opts.message ? { message: opts.message } : {}),
  }
  await reply.code(opts.statusCode ?? 200).send(body)
}

/**
 * Send a 201 Created with a standard success envelope.
 *
 * @example
 * return created(reply, booking, 'Booking confirmed')
 */
export async function created<T>(
  reply: FastifyReply,
  data: T,
  message?: string,
): Promise<void> {
  return ok(reply, data, { statusCode: 201, message })
}

/**
 * Send a paginated collection response with full pagination metadata.
 *
 * @example
 * return paginated(reply, bookings, { total, limit, offset })
 */
export async function paginated<T>(
  reply: FastifyReply,
  data: T[],
  pagination: { total: number; limit: number; offset: number },
  message?: string,
): Promise<void> {
  const body: SuccessEnvelope<T[]> = {
    success:   true,
    data,
    meta:      buildMeta(pagination.total, pagination.limit, pagination.offset),
    timestamp: new Date().toISOString(),
    ...(message ? { message } : {}),
  }
  await reply.code(200).send(body)
}

/**
 * Send a 204 No Content response (e.g., after a DELETE).
 */
export async function noContent(reply: FastifyReply): Promise<void> {
  await reply.code(204).send()
}

// ── Error envelope builder (used by error-handler.ts) ────────────────────────

/**
 * Build a typed error envelope.  Called internally by the error handler;
 * application code should throw errors, not call this directly.
 */
export function buildErrorEnvelope(
  code:     string,
  message:  string,
  details?: ErrorDetail[],
): ErrorEnvelope {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details?.length ? { details } : {}),
    },
    timestamp: new Date().toISOString(),
  }
}
