// One line above the timeline: which run this is, its state, and, when it is
// blocked, how long it has been waiting on someone.
import { Badge } from './Badge'
import { formatDuration, isoDuration } from '../lib/duration'
import { useNow } from '../lib/useNow'

const STATUS_TONE: Record<string, string> = {
  running: 'running',
  completed: 'done',
  blocked: 'failed',
}

/** The blocked duration only changes once a second. */
const BLOCKED_TICK_MS = 1000

export function RunStatus({
  runId,
  status,
  blockedSince,
}: {
  runId: string
  status: string
  /** Epoch ms the run started waiting on someone. Null when it is not. */
  blockedSince: number | null
}) {
  return (
    <p data-testid="run-status" className="flex items-center gap-2 text-sm">
      <span className="font-mono font-medium">{runId}</span>
      {status !== 'unknown' && (
        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
      )}
      {blockedSince !== null && <BlockedFor since={blockedSince} />}
    </p>
  )
}

/** A component of its own so that its once-a-second tick re-renders this text
 *  and nothing else. */
function BlockedFor({ since }: { since: number }) {
  const now = useNow(true, BLOCKED_TICK_MS)
  const waited = now - since

  return (
    <span
      data-testid="blocked-for"
      className="text-ink-soft tabular-nums"
      title={`Waiting since ${new Date(since).toLocaleTimeString()}`}
    >
      for <time dateTime={isoDuration(waited)}>{formatDuration(waited)}</time>
    </span>
  )
}
