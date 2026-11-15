/**
 * Booking Controller — thin HTTP adapter layer.
 *
 * Uses response helpers (ok, created, paginated) for every success response
 * so the entire API surface produces a consistent envelope.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  CreateBookingSchema,
  CancelBookingSchema,
  BookingParamsSchema,
  UserParamsSchema,
  ListBookingsQuerySchema,
  validate,
} from '../utils/validation.js'
import {
  createBooking,
  getBookingById,
  listUserBookings,
  cancelBooking,
} from '../services/booking.service.js'
import { ok, created, paginated } from '../utils/response.js'

// ── Stubbed auth helper ───────────────────────────────────────────────────────
// Replace with real JWT / session extraction when auth is implemented.

interface RequestUser {
  id: string
  email: string
  name: string
}

function getRequestUser(_req: FastifyRequest): RequestUser {
  // TODO: extract from req.user after JWT plugin is added
  return {
    id:    'usr_demo_01',
    email: 'demo@hyperstack.dev',
    name:  'Demo User',
  }
}

// ── POST /api/v1/bookings ─────────────────────────────────────────────────────

export async function createBookingHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user  = getRequestUser(req)
  const input = validate(CreateBookingSchema, req.body)

  const { booking, queued } = await createBooking({
    ...input,
    userId:    user.id,
    userEmail: user.email,
    userName:  user.name,
  })

  await created(reply, { booking, confirmationQueued: queued }, 'Booking confirmed')
}

// ── GET /api/v1/bookings/:bookingId ──────────────────────────────────────────

export async function getBookingHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { bookingId } = validate(BookingParamsSchema, req.params)
  const booking       = await getBookingById(bookingId)

  await ok(reply, booking)
}

// ── GET /api/v1/users/:userId/bookings ───────────────────────────────────────

export async function listBookingsHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = validate(UserParamsSchema, req.params)
  const query      = validate(ListBookingsQuerySchema, req.query)

  const { bookings, total } = await listUserBookings(userId, query)

  await paginated(reply, bookings, {
    total,
    limit:  query.limit,
    offset: query.offset,
  })
}

// ── DELETE /api/v1/bookings/:bookingId ───────────────────────────────────────

export async function cancelBookingHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user          = getRequestUser(req)
  const { bookingId } = validate(BookingParamsSchema, req.params)
  const { reason }    = validate(CancelBookingSchema, req.body ?? {})

  const booking = await cancelBooking(bookingId, user.id, reason)

  await ok(reply, booking, { message: 'Booking cancelled' })
}
