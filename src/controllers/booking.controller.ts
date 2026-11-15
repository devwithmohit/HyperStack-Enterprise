/**
 * Booking Controller — thin HTTP adapter layer.
 *
 * Responsibilities:
 *  • Extract and validate request data (body, params, query).
 *  • Delegate business logic entirely to BookingService.
 *  • Shape HTTP responses (status codes, bodies).
 *  • Never contain business logic itself.
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

// ── POST /bookings ────────────────────────────────────────────────────────────

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

  await reply.code(201).send({
    success:              true,
    data:                 booking,
    confirmationQueued:   queued,
  })
}

// ── GET /bookings/:bookingId ──────────────────────────────────────────────────

export async function getBookingHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { bookingId } = validate(BookingParamsSchema, req.params)
  const booking       = await getBookingById(bookingId)

  await reply.code(200).send({ success: true, data: booking })
}

// ── GET /users/:userId/bookings ───────────────────────────────────────────────

export async function listBookingsHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = validate(UserParamsSchema, req.params)
  const query      = validate(ListBookingsQuerySchema, req.query)

  const { bookings, total } = await listUserBookings(userId, query)

  await reply.code(200).send({
    success: true,
    data:    bookings,
    meta: {
      total,
      limit:  query.limit,
      offset: query.offset,
    },
  })
}

// ── DELETE /bookings/:bookingId ───────────────────────────────────────────────

export async function cancelBookingHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user          = getRequestUser(req)
  const { bookingId } = validate(BookingParamsSchema, req.params)
  const { reason }    = validate(CancelBookingSchema, req.body ?? {})

  const booking = await cancelBooking(bookingId, user.id, reason)

  await reply.code(200).send({ success: true, data: booking })
}
