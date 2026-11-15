import { buildApp } from './app.js'
import { config } from './config/index.js'
import { toError } from './utils/index.js'

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(
      `🚀 hyperstack-enterprise running on http://${config.host}:${config.port}`,
    )
  } catch (err) {
    app.log.error(toError(err), 'Server failed to start')
    process.exit(1)
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  const app = await buildApp()
  app.log.info(`Received ${signal} — shutting down gracefully…`)
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

void main()
