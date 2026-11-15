/**
 * Workers index — start and stop all background workers.
 *
 * Import this module in server.ts to attach worker lifecycle to the
 * process startup / graceful-shutdown sequence.
 */

import type { Worker } from 'bullmq'
import { createEmailWorker, closeEmailWorker } from './email.worker.js'
import { logger } from '../config/logger.js'

let emailWorker: Worker | null = null

/**
 * Spin up all background workers.
 * Call after the Redis connection is established.
 */
export function startWorkers(): void {
  emailWorker = createEmailWorker()
  logger.info('Background workers started ✔')
}

/**
 * Drain in-progress jobs and close all worker connections.
 * Call during graceful shutdown before disconnecting Redis.
 */
export async function stopWorkers(force = false): Promise<void> {
  logger.info('Stopping background workers…')

  await Promise.allSettled([
    emailWorker ? closeEmailWorker(emailWorker, force) : Promise.resolve(),
  ])

  emailWorker = null
  logger.info('Background workers stopped ✔')
}
