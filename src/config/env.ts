import 'dotenv/config'
import { logger } from './logger.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface EnvVar {
  key: string
  required: boolean
  fallback?: string
  description: string
}

// ── Schema ───────────────────────────────────────────────────────────────────

const schema: EnvVar[] = [
  {
    key: 'NODE_ENV',
    required: true,
    fallback: 'development',
    description: 'Application runtime environment (development | production | test)',
  },
  {
    key: 'PORT',
    required: true,
    fallback: '3000',
    description: 'HTTP port the server listens on',
  },
  {
    key: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL connection string (postgresql://user:pass@host:port/db)',
  },
  {
    key: 'REDIS_HOST',
    required: true,
    description: 'Redis server hostname',
  },
  {
    key: 'REDIS_PORT',
    required: true,
    fallback: '6379',
    description: 'Redis server port',
  },
]

// ── Validation ───────────────────────────────────────────────────────────────

function validate(): void {
  const missing: string[] = []

  for (const variable of schema) {
    const raw = process.env[variable.key]

    if (raw === undefined || raw.trim() === '') {
      if (variable.fallback !== undefined) {
        process.env[variable.key] = variable.fallback
        logger.debug(
          { key: variable.key, fallback: variable.fallback },
          'env variable missing — using fallback',
        )
      } else if (variable.required) {
        missing.push(`  • ${variable.key}: ${variable.description}`)
      }
    }
  }

  if (missing.length > 0) {
    logger.error(
      `\n\n🔴  Missing required environment variables:\n\n${missing.join('\n')}\n\n` +
      `  Copy .env.example → .env and fill in the missing values.\n`,
    )
    process.exit(1)
  }
}

validate()

// ── Typed config ─────────────────────────────────────────────────────────────

export const env = {
  nodeEnv:     process.env['NODE_ENV']     as string,
  port:        parseInt(process.env['PORT'] as string, 10),
  host:        process.env['HOST']         ?? '0.0.0.0',
  logLevel:    process.env['LOG_LEVEL']    ?? 'info',
  databaseUrl: process.env['DATABASE_URL'] as string,
  redisHost:   process.env['REDIS_HOST']   as string,
  redisPort:   parseInt(process.env['REDIS_PORT'] as string, 10),
  isDev:       (process.env['NODE_ENV'] ?? 'development') === 'development',
} as const

export type Env = typeof env
