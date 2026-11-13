// Renders nothing while the connection is live.
import type { Connection } from '../lib/runState'

const TONE: Record<string, string> = {
  connecting: 'border-line bg-surface text-ink-soft',
  live: '',
  stale: 'border-stale/30 bg-stale-soft text-ink',
  gap: 'border-failed/30 bg-failed-soft text-ink',
}

const DEFAULT_NOTE: Record<string, string> = {
  connecting: 'Connecting to the run.',
  stale: 'Disconnected. This screen is not being updated.',
  gap: 'Reconnected, but part of this run was not recorded.',
}

export function Banner({ connection }: { connection: Connection }) {
  if (connection.status === 'live') return null
  return (
    <div
      role="status"
      data-testid="connection-banner"
      data-status={connection.status}
      className={`rounded-md border px-4 py-2.5 text-sm ${TONE[connection.status] ?? ''}`}
    >
      {connection.note ?? DEFAULT_NOTE[connection.status]}
    </div>
  )
}
