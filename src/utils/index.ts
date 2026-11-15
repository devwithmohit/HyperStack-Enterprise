/**
 * Wraps a value that may be an Error or unknown into a typed Error.
 */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * Pauses execution for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
