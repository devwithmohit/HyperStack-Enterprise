/**
 * Booking Service — core business logic layer.
 *
 * Rules:
 *  1. Acquire a Redis distributed lock on the resource before writing.
 *  2. Check whether the resource is already CONFIRMED (idempotency guard).
 *  3. Write the booking row inside a Prisma transaction.
 *  4. Enqueue a confirmation email via BullMQ (non-blocking, fire-and-forget).
 *  5. Release the lock in `finally` — always.
 *
 * The lock window (5 s) comfortably covers the DB transaction; the email
 * enqueue is outside the lock because it is non-critical and idempotent.
 */

import { BookingStatus, type Booking, type Prisma } from '@prisma/client'
import { db } from '../config/database.js'
import { redis } from '../config/redis.js'
import { logger } from '../config/logger.js'
import { DistributedLock, LockNotAcquiredError } from '../utils/distributed-lock.js'
import { enqueueBookingConfirmationEmail } from '../queues/email.queue.js'
import type { CreateBookingInput, ListBookingsQuery } from '../utils/validation.js'
import { createError } from '@fastify/error'

// ── Domain errors ─────────────────────────────────────────────────────────────

export const ResourceAlreadyBookedError = createError(
  'HSE_RESOURCE_BOOKED',
  'Resource "%s" is already confirmed by another booking.',
  409,
)

export const BookingNotFoundError = createError(
  'HSE_BOOKING_NOT_FOUND',
  'Booking "%s" not found.',
  404,
)

export const BookingNotCancellableError = createError(
  'HSE_BOOKING_NOT_CANCELLABLE',
  'Booking "%s" is in status %s and cannot be cancelled.',
  409,
)

export const LockTimeoutError = createError(
  'HSE_LOCK_TIMEOUT',
  'Could not acquire lock on resource "%s" — too many concurrent requests. Try again.',
  503,
)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateBookingParams extends CreateBookingInput {
  userId: string
  userEmail: string
  userName: string
}

export interface BookingResult {
  booking: Booking
  queued: boolean
}

// ── Service methods ───────────────────────────────────────────────────────────

/**
 * Create a booking for a resource, guarded by a distributed lock.
 */
export async function createBooking(
  params: CreateBookingParams,
): Promise<BookingResult> {
  const { userId, userEmail, userName, resourceId, amountMinorUnits, currency, metadata } = params
  const lockKey = `booking:resource:${resourceId}`

  logger.info({ userId, resourceId }, 'Attempting to create booking')

  let booking: Booking

  try {
    booking = await DistributedLock.withLock(
      redis,
      lockKey,
      async () => {
        // ── Idempotency guard: check for an existing CONFIRMED booking ─────
        const existing = await db.booking.findFirst({
          where: { resourceId, status: BookingStatus.CONFIRMED },
          select: { id: true },
        })

        if (existing) {
          throw new ResourceAlreadyBookedError(resourceId)
        }

        // ── Write booking in a transaction ────────────────────────────────
        return await db.$transaction(async (tx: Prisma.TransactionClient) => {
          // Upsert the user (idempotent — real auth would look them up instead)
          await tx.user.upsert({
            where:  { id: userId },
            update: {},
            create: { id: userId, email: userEmail, name: userName },
          })

          return tx.booking.create({
            data: {
              userId,
              resourceId,
              status:           BookingStatus.CONFIRMED,
              amountMinorUnits,
              currency,
              metadata:         metadata ?? Prisma.JsonNull,
              version:          1,
            },
          })
        })
      },
      {
        ttlMs:          5_000,   // lock lives 5 s — covers DB round-trip
        retryTimeoutMs: 3_000,   // keep trying for 3 s before giving up
        retryDelayMs:   80,
        jitterMs:       40,
      },
    )
  } catch (err) {
    if (err instanceof LockNotAcquiredError) {
      logger.warn({ userId, resourceId }, 'Lock timeout on booking creation')
      throw new LockTimeoutError(resourceId)
    }
    throw err
  }

  logger.info({ bookingId: booking.id, userId, resourceId }, 'Booking created ✔')

  // ── Fire-and-forget: enqueue confirmation email ───────────────────────────
  let queued = false
  try {
    await enqueueBookingConfirmationEmail({
      to:               userEmail,
      name:             userName,
      bookingId:        booking.id,
      resourceId:       booking.resourceId,
      amountMinorUnits: booking.amountMinorUnits,
      currency:         booking.currency,
    })
    queued = true
  } catch (err) {
    // Email failure must not roll back a successful booking
    logger.error({ err, bookingId: booking.id }, 'Failed to enqueue confirmation email')
  }

  return { booking, queued }
}

/**
 * Retrieve a single booking by ID.
 */
export async function getBookingById(bookingId: string): Promise<Booking> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
  })

  if (!booking) throw new BookingNotFoundError(bookingId)
  return booking
}

/**
 * List bookings for a user with optional status filter and pagination.
 */
export async function listUserBookings(
  userId: string,
  query: ListBookingsQuery,
): Promise<{ bookings: Booking[]; total: number }> {
  const where: Prisma.BookingWhereInput = {
    userId,
    ...(query.status ? { status: BookingStatus[query.status] } : {}),
  }

  const [bookings, total] = await Promise.all([
    db.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    query.limit,
      skip:    query.offset,
    }),
    db.booking.count({ where }),
  ])

  return { bookings, total }
}

/**
 * Cancel a booking — only PENDING or CONFIRMED bookings may be cancelled.
 */
export async function cancelBooking(
  bookingId: string,
  userId: string,
  reason?: string,
): Promise<Booking> {
  const booking = await getBookingById(bookingId)

  // Ownership check
  if (booking.userId !== userId) throw new BookingNotFoundError(bookingId)

  const cancellable: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.CONFIRMED]
  if (!cancellable.includes(booking.status)) {
    throw new BookingNotCancellableError(bookingId, booking.status)
  }

  // Optimistic-lock update — only succeeds if version hasn't changed
  const updated = await db.booking.updateMany({
    where:  { id: bookingId, version: booking.version },
    data:   {
      status:   BookingStatus.CANCELLED,
      version:  { increment: 1 },
      metadata: { ...(booking.metadata as object ?? {}), cancellationReason: reason },
    },
  })

  if (updated.count === 0) {
    // Version mismatch — concurrent update won; re-fetch and report current state
    const current = await getBookingById(bookingId)
    throw new BookingNotCancellableError(bookingId, current.status)
  }

  logger.info({ bookingId, userId, reason }, 'Booking cancelled ✔')
  return getBookingById(bookingId)
}
