// The browser tab title. The tab usually sits in the background while the
// scientist works elsewhere, so the title starts with the run's state.
import type { ConnectionStatus } from './runState'

export const APP_TITLE = 'Lab run monitor'

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
}

/** e.g. "Blocked · r-1 · Lab run monitor". */
export function pageTitle(
  runId: string,
  status: string,
  connection: ConnectionStatus,
): string {
  const headline = headlineFor(status, connection)
  return [headline, runId, APP_TITLE]
    .filter((part) => part !== null)
    .join(' · ')
}

/** A blocked run comes first because it needs someone regardless. Otherwise a
 *  lost connection does, because any other status could be out of date. */
function headlineFor(
  status: string,
  connection: ConnectionStatus,
): string | null {
  if (status === 'blocked') return 'Blocked'
  if (connection === 'stale') return 'Disconnected'
  return STATUS_LABEL[status] ?? null
}
