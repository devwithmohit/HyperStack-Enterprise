/**
 * Booking validation schemas — Zod-based.
 *
 * We use Zod (pure TypeScript, zero runtime reflection) for:
 *  • Schema definition + inferred static types in one place.
 *  • Descriptive error messages sent back to callers as 400 payloads.
 *  • A thin `validate()` helper that throws a shaped Fastify error on failure.
 */

import { z } from 'zod'
import { createError } from '@fastify/error'

// ── Custom Fastify error ──────────────────────────────────────────────────────

export const ValidationError = createError(
  'FST_VALIDATION_ERROR',
  '%s',
  400,
)

// ── Shared field schemas ──────────────────────────────────────────────────────

const cuid = z
  .string({ required_error: 'ID is required' })
  .min(1, 'ID cannot be empty')

const isoAlpha3Currency = z
  .string()
  .length(3, 'currency must be an ISO-4217 3-letter code (e.g. "USD", "INR")')
  .regex(/^[A-Z]{3}$/, 'currency must be uppercase letters only')

// ── Create Booking ────────────────────────────────────────────────────────────

export const CreateBookingSchema = z.object({
  /** The resource to reserve (seat id, slot id, product sku, etc.) */
  resourceId: z
    .string({ required_error: 'resourceId is required' })
    .min(1, 'resourceId cannot be empty')
    .max(255, 'resourceId too long'),

  /** Monetary amount in the smallest currency unit (cents, paise, …) */
  amountMinorUnits: z
    .number({ required_error: 'amountMinorUnits is required' })
    .int('amountMinorUnits must be an integer')
    .nonnegative('amountMinorUnits must be ≥ 0'),

  currency: isoAlpha3Currency.default('USD'),

  /** Optional free-form metadata (seat label, event name, etc.) */
  metadata: z.record(z.unknown()).optional(),
})

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>

// ── Cancel Booking ────────────────────────────────────────────────────────────

export const CancelBookingSchema = z.object({
  reason: z
    .string()
    .min(3,  'Cancellation reason must be at least 3 characters')
    .max(500, 'Cancellation reason too long')
    .optional(),
})

export type CancelBookingInput = z.infer<typeof CancelBookingSchema>

// ── Path params ───────────────────────────────────────────────────────────────

export const BookingParamsSchema = z.object({
  bookingId: cuid,
})

export type BookingParams = z.infer<typeof BookingParamsSchema>

export const UserParamsSchema = z.object({
  userId: cuid,
})

// ── Query params ──────────────────────────────────────────────────────────────

export const ListBookingsQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'FAILED'])
    .optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 0))
    .pipe(z.number().int().nonnegative()),
})

export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>

// ── Generic validate helper ───────────────────────────────────────────────────

/**
 * Parse `data` against `schema`. On failure, throws a Fastify 400 error
 * with a structured message listing every violated field.
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const messages = result.error.errors
    .map((e) => `${e.path.join('.') || 'body'}: ${e.message}`)
    .join('; ')

  throw new ValidationError(messages)
}
