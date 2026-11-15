export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  service: string
  timestamp: string
}

export function getHealthStatus(): HealthStatus {
  return {
    status: 'ok',
    service: 'hyperstack-enterprise',
    timestamp: new Date().toISOString(),
  }
}
