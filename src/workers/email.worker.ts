/**
 * Email Worker — BullMQ worker that consumes jobs from the email queue.
 *
 * Design decisions:
 *  • A discriminated union on `job.data.type` gives exhaustive type-safe
 *    dispatch without any runtime casting.
 *  • Each handler is an isolated async function; errors bubble up naturally
 *    so BullMQ's retry/backoff machinery takes over.
 *  • `concurrency: 5` — process up to 5 email jobs in parallel within one
 *    worker process.  Tune this against your SMTP provider's rate limits.
 *  • The worker's own Redis connection is separate from the app's main
 *    connection (BullMQ requirement).
 */

import { Worker, type Job, type WorkerOptions } from 'bullmq'
import { bullMQConnection } from '../queues/bullmq-connection.js'
import {
  EMAIL_QUEUE_NAME,
  type EmailJobPayload,
  type WelcomeEmailJob,
  type PasswordResetEmailJob,
  type BookingConfirmationEmailJob,
  type GenericNotificationEmailJob,
} from '../queues/email.queue.js'
import { logger } from '../config/logger.js'
import { sleep } from '../utils/index.js'

// ── Simulated handlers (replace with real SMTP / SES / SendGrid calls) ────────

async function handleWelcomeEmail(job: Job<WelcomeEmailJob>): Promise<void> {
  const { to, name } = job.data
  logger.info({ jobId: job.id, to, name }, 'Sending welcome email…')

  // Simulate network latency to an SMTP relay
  await sleep(200 + Math.random() * 300)

  // ── Replace this block with your real email provider SDK call ─────────────
  // e.g. await sendgrid.send({ to, subject: `Welcome, ${name}!`, html: … })
  // ──────────────────────────────────────────────────────────────────────────

  logger.info({ jobId: job.id, to }, 'Welcome email sent ✔')
}

async function handlePasswordResetEmail(
  job: Job<PasswordResetEmailJob>,
): Promise<void> {
  const { to, resetToken, expiresAt } = job.data
  logger.info({ jobId: job.id, to, expiresAt }, 'Sending password reset email…')

  await sleep(150 + Math.random() * 200)

  // e.g. await ses.sendEmail({ Destination: { ToAddresses: [to] }, … })

  logger.info({ jobId: job.id, to }, 'Password reset email sent ✔')

  // Suppress token from logs after use
  void resetToken
}

async function handleBookingConfirmationEmail(
  job: Job<BookingConfirmationEmailJob>,
): Promise<void> {
  const { to, name, bookingId, resourceId, amountMinorUnits, currency } = job.data

  logger.info(
    { jobId: job.id, to, bookingId, resourceId },
    'Sending booking confirmation email…',
  )

  await sleep(300 + Math.random() * 400)   // simulate PDF generation + send

  // e.g. await mailgun.messages.create(domain, { to, subject: `Booking #${bookingId}`, … })

  logger.info(
    { jobId: job.id, to, bookingId, amountMinorUnits, currency },
    'Booking confirmation email sent ✔',
  )
}

async function handleGenericNotificationEmail(
  job: Job<GenericNotificationEmailJob>,
): Promise<void> {
  const { to, subject } = job.data
  logger.info({ jobId: job.id, to, subject }, 'Sending notification email…')

  await sleep(100 + Math.random() * 150)

  logger.info({ jobId: job.id, to }, 'Notification email sent ✔')
}

// ── Main processor (exhaustive dispatch) ──────────────────────────────────────

async function processEmailJob(job: Job<EmailJobPayload>): Promise<void> {
  logger.debug(
    { jobId: job.id, type: job.data.type, attempt: job.attemptsMade + 1 },
    'Processing email job',
  )

  // Discriminated union — TypeScript narrows the type in each branch
  switch (job.data.type) {
    case 'welcome':
      await handleWelcomeEmail(job as Job<WelcomeEmailJob>)
      break

    case 'password-reset':
      await handlePasswordResetEmail(job as Job<PasswordResetEmailJob>)
      break

    case 'booking-confirmation':
      await handleBookingConfirmationEmail(job as Job<BookingConfirmationEmailJob>)
      break

    case 'notification':
      await handleGenericNotificationEmail(job as Job<GenericNotificationEmailJob>)
      break

    default: {
      // TypeScript exhaustiveness check — this branch is unreachable if the
      // union is kept in sync with the queue payload types.
      const _exhaustive: never = job.data
      logger.error(
        { jobId: job.id, data: job.data },
        'Unknown email job type — skipping',
      )
      void _exhaustive
    }
  }
}

// ── Worker factory ────────────────────────────────────────────────────────────

const WORKER_OPTIONS: WorkerOptions = {
  connection: bullMQConnection,
  concurrency: 5,          // parallel jobs per process

  // Auto-remove completed/failed jobs mirrors the queue's defaultJobOptions.
  removeOnComplete: { count: 1_000 },
  removeOnFail:     { age: 60 * 60 * 24 * 7 },
}

export function createEmailWorker(): Worker<EmailJobPayload> {
  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    processEmailJob,
    WORKER_OPTIONS,
  )

  // ── Worker-level lifecycle events ─────────────────────────────────────────

  worker.on('active', (job) =>
    logger.debug(
      { jobId: job.id, type: job.data.type },
      'Email job started',
    ),
  )

  worker.on('completed', (job) =>
    logger.info(
      { jobId: job.id, type: job.data.type, durationMs: Date.now() - job.timestamp },
      'Email job completed ✔',
    ),
  )

  worker.on('failed', (job, err) =>
    logger.error(
      {
        jobId: job?.id,
        type: job?.data.type,
        attempt: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
        err,
      },
      'Email job failed ✘',
    ),
  )

  worker.on('error', (err) =>
    logger.error({ source: 'email-worker', err }, 'Worker error'),
  )

  worker.on('stalled', (jobId) =>
    logger.warn({ jobId, source: 'email-worker' }, 'Job stalled — will be retried'),
  )

  logger.info(
    { queue: EMAIL_QUEUE_NAME, concurrency: WORKER_OPTIONS.concurrency },
    'Email worker started ✔',
  )

  return worker
}

// ── Graceful shutdown helper ──────────────────────────────────────────────────

/**
 * Close the worker: finish in-progress jobs, then disconnect.
 * Pass `force = true` only when the process must exit immediately.
 */
export async function closeEmailWorker(
  worker: Worker,
  force = false,
): Promise<void> {
  logger.info({ source: 'email-worker' }, 'Closing email worker…')
  await worker.close(force)
  logger.info({ source: 'email-worker' }, 'Email worker closed ✔')
}
