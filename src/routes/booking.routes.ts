/**
 * Booking Routes — Fastify plugin.
 *
 * All routes share:
 *  • Strict JSON-schema response shapes (Fastify serializes faster with these).
 *  • Rate-limiting inherited from the global app hook (standardRateLimiter).
 *  • POST /bookings gets an extra strict limiter to prevent booking-spam.
 */

import type { FastifyInstance } from 'fastify'
import { redis } from '../config/redis.js'
import { strictRateLimiter } from '../middleware/rate-limiter.js'
import {
  createBookingHandler,
  getBookingHandler,
  listBookingsHandler,
  cancelBookingHandler,
} from '../controllers/booking.controller.js'

// ── Shared response schemas (Fastify fast-json-stringify) ─────────────────────

const BookingSchema = {
  type: 'object',
  properties: {
    id:               { type: 'string' },
    userId:           { type: 'string' },
    resourceId:       { type: 'string' },
    status:           { type: 'string' },
    amountMinorUnits: { type: 'integer' },
    currency:         { type: 'string' },
    version:          { type: 'integer' },
    metadata:         { type: 'object', nullable: true },
    createdAt:        { type: 'string', format: 'date-time' },
    updatedAt:        { type: 'string', format: 'date-time' },
  },
} as const

const ErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer' },
    code:       { type: 'string' },
    error:      { type: 'string' },
    message:    { type: 'string' },
  },
} as const

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function bookingRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /bookings ──────────────────────────────────────────────────────────
  // High-concurrency endpoint: create a booking for a resource.
  // Extra rate-limiter: 10 req/min per IP to prevent booking storms.
  app.post('/bookings', {
    onRequest: strictRateLimiter(redis),
    schema: {
      tags:    ['Bookings'],
      summary: 'Create a booking (distributed-lock guarded)',
      body: {
        type: 'object',
        required: ['resourceId', 'amountMinorUnits'],
        properties: {
          resourceId:       { type: 'string', minLength: 1 },
          amountMinorUnits: { type: 'integer', minimum: 0 },
          currency:         { type: 'string', minLength: 3, maxLength: 3 },
          metadata:         { type: 'object', nullable: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success:            { type: 'boolean' },
            data:               BookingSchema,
            confirmationQueued: { type: 'boolean' },
          },
        },
        400: ErrorSchema,
        409: ErrorSchema,
        429: ErrorSchema,
        503: ErrorSchema,
      },
    },
    handler: createBookingHandler,
  })

  // ── GET /bookings/:bookingId ────────────────────────────────────────────────
  app.get('/bookings/:bookingId', {
    schema: {
      tags:    ['Bookings'],
      summary: 'Get a booking by ID',
      params: {
        type: 'object',
        properties: { bookingId: { type: 'string' } },
        required: ['bookingId'],
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: BookingSchema },
        },
        404: ErrorSchema,
      },
    },
    handler: getBookingHandler,
  })

  // ── GET /users/:userId/bookings ─────────────────────────────────────────────
  app.get('/users/:userId/bookings', {
    schema: {
      tags:    ['Bookings'],
      summary: 'List bookings for a user',
      params: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING','CONFIRMED','CANCELLED','COMPLETED','FAILED'] },
          limit:  { type: 'string' },
          offset: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data:    { type: 'array', items: BookingSchema },
            meta: {
              type: 'object',
              properties: {
                total:  { type: 'integer' },
                limit:  { type: 'integer' },
                offset: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    handler: listBookingsHandler,
  })

  // ── DELETE /bookings/:bookingId ─────────────────────────────────────────────
  app.delete('/bookings/:bookingId', {
    schema: {
      tags:    ['Bookings'],
      summary: 'Cancel a booking (optimistic-lock guarded)',
      params: {
        type: 'object',
        properties: { bookingId: { type: 'string' } },
        required: ['bookingId'],
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', minLength: 3, maxLength: 500 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: BookingSchema },
        },
        404: ErrorSchema,
        409: ErrorSchema,
      },
    },
    handler: cancelBookingHandler,
  })
}
