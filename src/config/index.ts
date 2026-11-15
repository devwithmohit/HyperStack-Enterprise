import 'dotenv/config'

const env = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return val
}

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  port: parseInt(env('PORT', '3000'), 10),
  host: env('HOST', '0.0.0.0'),
  logLevel: env('LOG_LEVEL', 'info'),
  isDev: (process.env['NODE_ENV'] ?? 'development') === 'development',
} as const

export type Config = typeof config
