/**
 * Email Queue — BullMQ queue definition and job type contracts.
 *
 * Responsibilities:
 *  • Define the shape of every email job variant (discriminated union).
 *  • Export the singleton Queue instance used by producers (routes/services).
 *  • Export typed `addEmailJob` helpers so callers never construct raw data.
 *
 * This module is import-only for the HTTP process.
 * The actual processing lives in src/workers/email.worker.ts.
 */

import { Queue, QueueEvents } from 'bullmq'
import { bullMQConnection } from './bullmq-connection.js'
import { logger } from '../config/logger.js'

// ── Job payload types (discriminated union) ───────────────────────────────────

export interface WelcomeEmailJob {
  type: 'welcome'
  to: string
  name: string
}

export interface PasswordResetEmailJob {
  type: 'password-reset'
  to: string
  resetToken: string
  expiresAt: string   // ISO-8601
}

export interface BookingConfirmationEmailJob {
  type: 'booking-confirmation'
  to: string
  name: string
  bookingId: string
  resourceId: string
  amountMinorUnits: number
  currency: string
}

export interface GenericNotificationEmailJob {
  type: 'notification'
  to: string
  subject: string
  body: string
}

export type EmailJobPayload =
  | WelcomeEmailJob
  | PasswordResetEmailJob
  | BookingConfirmationEmailJob
  | GenericNotificationEmailJob

// ── Queue name constant ───────────────────────────────────────────────────────

export const EMAIL_QUEUE_NAME = 'email' as const

// ── Singleton Queue ───────────────────────────────────────────────────────────

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: bullMQConnection,

  defaultJobOptions: {
    attempts: 5,

    backoff: {
      type: 'exponential',
      delay: 2_000,          // 2 s, 4 s, 8 s, 16 s, 32 s
    },

    removeOnComplete: {
      age: 60 * 60 * 24,    // keep completed jobs for 24 h (for observability)
      count: 1_000,
    },

    removeOnFail: {
      age: 60 * 60 * 24 * 7, // keep failed jobs for 7 days (for auditing)
    },
  },
})

// ── Queue-level event logging ─────────────────────────────────────────────────

const queueEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
  connection: bullMQConnection,
})

queueEvents.on('completed', ({ jobId }) =>
  logger.info({ queue: EMAIL_QUEUE_NAME, jobId }, 'Email job completed ✔'),
)

queueEvents.on('failed', ({ jobId, failedReason }) =>
  logger.error({ queue: EMAIL_QUEUE_NAME, jobId, failedReason }, 'Email job failed ✘'),
)

queueEvents.on('stalled', ({ jobId }) =>
  logger.warn({ queue: EMAIL_QUEUE_NAME, jobId }, 'Email job stalled — will be retried'),
)

// ── Typed producer helpers ────────────────────────────────────────────────────

/**
 * Enqueue a welcome email (fires immediately, normal priority).
 */
export async function enqueueWelcomeEmail(
  payload: Omit<WelcomeEmailJob, 'type'>,
): Promise<string> {
  const job = await emailQueue.add('welcome', { type: 'welcome', ...payload })
  logger.info({ queue: EMAIL_QUEUE_NAME, jobId: job.id, to: payload.to }, 'Welcome email queued')
  return job.id!
}

/**
 * Enqueue a password-reset email with high priority.
 */
export async function enqueuePasswordResetEmail(
  payload: Omit<PasswordResetEmailJob, 'type'>,
): Promise<string> {
  const job = await emailQueue.add(
    'password-reset',
    { type: 'password-reset', ...payload },
    { priority: 1 },   // 1 = highest priority
  )
  logger.info({ queue: EMAIL_QUEUE_NAME, jobId: job.id, to: payload.to }, 'Password reset email queued')
  return job.id!
}

/**
 * Enqueue a booking confirmation email.
 */
export async function enqueueBookingConfirmationEmail(
  payload: Omit<BookingConfirmationEmailJob, 'type'>,
): Promise<string> {
  const job = await emailQueue.add('booking-confirmation', {
    type: 'booking-confirmation',
    ...payload,
  })
  logger.info(
    { queue: EMAIL_QUEUE_NAME, jobId: job.id, to: payload.to, bookingId: payload.bookingId },
    'Booking confirmation email queued',
  )
  return job.id!
}

/**
 * Drain and close the queue connection.
 * Call during graceful shutdown.
 */
export async function closeEmailQueue(): Promise<void> {
  await Promise.all([
    emailQueue.close(),
    queueEvents.close(),
  ])
  logger.info({ queue: EMAIL_QUEUE_NAME }, 'Email queue closed ✔')
}
