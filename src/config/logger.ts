import pino from 'pino'

const isDev = (process.env['NODE_ENV'] ?? 'development') === 'development'
const level = process.env['LOG_LEVEL'] ?? 'info'

const transport = isDev
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '{msg}',
          levelFirst: false,
        },
      },
    }
  : {}

export const logger = pino({
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'hyperstack-enterprise' },
  formatters: {
    level(label) {
      return { level: label }
    },
  },
  ...transport,
})

export type Logger = typeof logger
