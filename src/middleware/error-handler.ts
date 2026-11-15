/**
 * Global Fastify Error Handler & 404 Handler.
 *
 * Normalises every possible error origin into the standard ErrorEnvelope:
 *   { success: false, error: { code, message, [details] }, timestamp }
 *
 * Error origins handled:
 *   1. Domain errors       — @fastify/error instances (HSE_*, FST_*)
 *   2. Fastify built-in    — FST_ERR_VALIDATION (body/param/query schema)
 *   3. Prisma errors       — PrismaClientKnownRequestError (P2002, P2025…)
 *   4. Zod validation      — surfaced via our validate() helper as FST_VALIDATION_ERROR
 *   5. Rate-limiter 429    — FST_RATE_LIMIT_EXCEEDED
 *   6. Generic JS errors   — anything else becomes 500
 *
 * Logging policy:
 *   • 4xx → warn  (client mistake, no alert needed)
 *   • 5xx → error (server fault, needs attention)
 *   • 500 message is redacted in production to avoid leaking internals
 */

import type { FastifyError, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { buildErrorEnvelope, type ErrorDetail } from '../utils/response.js'
import { env } from '../config/env.js'

// ── Prisma error code → HTTP status map ──────────────────────────────────────

const PRISMA_STATUS: Record<string, number> = {
  P2000: 400,  // Value too long for column
  P2001: 404,  // Record not found
  P2002: 409,  // Unique constraint violation
  P2003: 409,  // Foreign key constraint violation
  P2004: 409,  // Constraint failed
  P2005: 400,  // Invalid value for field type
  P2006: 400,  // Invalid value for field
  P2011: 400,  // Null constraint violation
  P2012: 400,  // Missing required value
  P2014: 409,  // Relation violation
  P2015: 404,  // Related record not found
  P2025: 404,  // Record to update/delete not found
}

// ── Prisma error code → user-friendly message map ────────────────────────────

const PRISMA_MESSAGE: Record<string, string> = {
  P2002: 'A record with that value already exists.',
  P2003: 'Related record not found.',
  P2025: 'Record not found.',
}

// ── Classifier helpers ────────────────────────────────────────────────────────

function isPrismaKnownError(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError
}

function isPrismaValidationError(
  err: unknown,
): err is Prisma.PrismaClientValidationError {
  return err instanceof Prisma.PrismaClientValidationError
}

function isFastifyError(err: unknown): err is FastifyError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as FastifyError).statusCode === 'number'
  )
}

// ── Fastify built-in validation error detail extractor ───────────────────────
// Fastify appends a `validation` array when its own JSON-schema validation fails.

interface FastifyValidationIssue {
  instancePath: string
  message:      string
}

function extractFastifyValidationDetails(
  err: FastifyError,
): ErrorDetail[] | undefined {
  const issues = (err as FastifyError & { validation?: FastifyValidationIssue[] }).validation
  if (!Array.isArray(issues)) return undefined

  return issues.map((issue) => ({
    field:   issue.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'body',
    message: issue.message ?? 'Invalid value',
  }))
}

// ── Main error handler ────────────────────────────────────────────────────────

export function buildErrorHandler(app: FastifyInstance) {
  return async function errorHandler(
    err: FastifyError,
    req:  FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {

    // ── 1. Prisma known request errors ───────────────────────────────────────
    if (isPrismaKnownError(err)) {
      const status  = PRISMA_STATUS[err.code]  ?? 500
      const message = PRISMA_MESSAGE[err.code] ?? (
        env.isDev ? err.message : 'A database error occurred.'
      )

      app.log.warn(
        { reqId: req.id, prismaCode: err.code, meta: err.meta },
        `Prisma error ${err.code}`,
      )

      await reply.code(status).send(
        buildErrorEnvelope(`PRISMA_${err.code}`, message),
      )
      return
    }

    // ── 2. Prisma validation error (bad query shape) ──────────────────────────
    if (isPrismaValidationError(err)) {
      app.log.error({ reqId: req.id, err }, 'Prisma validation error')

      await reply.code(500).send(
        buildErrorEnvelope(
          'PRISMA_VALIDATION',
          env.isDev ? err.message : 'A database error occurred.',
        ),
      )
      return
    }

    // ── 3. All other errors (FastifyError, domain errors, plain Errors) ───────
    const statusCode = isFastifyError(err) ? (err.statusCode ?? 500) : 500
    const isServer   = statusCode >= 500

    // Log at appropriate level
    if (isServer) {
      app.log.error(
        { reqId: req.id, err, stack: err.stack },
        'Unhandled server error',
      )
    } else {
      app.log.warn(
        { reqId: req.id, code: (err as FastifyError).code, msg: err.message },
        'Client error',
      )
    }

    // Extract field-level details when Fastify's own schema validation fired
    const details = extractFastifyValidationDetails(err as FastifyError)

    // Redact 5xx messages in production
    const message =
      isServer && !env.isDev
        ? 'An unexpected error occurred. Please try again later.'
        : err.message

    const code =
      (err as FastifyError).code ??
      (isServer ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR')

    await reply.code(statusCode).send(
      buildErrorEnvelope(code, message, details),
    )
  }
}

// ── 404 Not-Found handler ─────────────────────────────────────────────────────

export function buildNotFoundHandler() {
  return async function notFoundHandler(
    req:  FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    await reply.code(404).send(
      buildErrorEnvelope(
        'ROUTE_NOT_FOUND',
        `Route ${req.method} ${req.url} not found.`,
      ),
    )
  }
}
