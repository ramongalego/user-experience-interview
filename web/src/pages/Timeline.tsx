// One lane per device, one bar per attempt. Renders what selectTracks returns.
//
// A bar with no reported end is still running. It is striped and drawn up to
// the current time, never given an end the instrument has not reported. While
// anything is running the axis ends at the current time, marked with a line;
// otherwise it ends at the last reported time.
import { ticks, timeScale } from '../lib/scale'
import type { ReactNode } from 'react'
import { attemptKey } from '../lib/runState'
import type { Attempt, AttemptStatus, Track } from '../lib/runState'

type Scale = ReturnType<typeof timeScale>

const LANE_H = 40
const LABEL_W = 152
const WIDTH = 900
const MIN_BAR_W = 3

export function Timeline({
  tracks,
  start,
  end,
  ongoing,
  hrefFor,
  isResolved,
}: {
  tracks: Track[]
  /** Epoch ms the axis starts at. Null until something has started. */
  start: number | null
  /** Epoch ms the axis ends at: the present while ongoing, else the last report. */
  end: number
  ongoing: boolean
  /** Link target for a bar, when it should be clickable. */
  hrefFor?: (attempt: Attempt) => string | undefined
  /** Whether a failed attempt has since been retried. Those are drawn in a
   *  lighter style so open failures stand out. */
  isResolved?: (attempt: Attempt) => boolean
}) {
  const origin = start ?? end
  const x = timeScale(origin, end, WIDTH)

  return (
    <div data-testid="timeline" className="overflow-x-auto">
      <div className="relative" style={{ width: LABEL_W + WIDTH }}>
        <Axis offsets={ticks(origin, end)} x={(offset) => x(origin + offset)} />
        {tracks.map((track) => (
          <Lane key={track.deviceId} deviceId={track.deviceId}>
            {track.attempts.map((attempt) => (
              <Bar
                key={attemptKey(attempt)}
                attempt={attempt}
                x={x}
                end={end}
                href={hrefFor?.(attempt)}
                resolved={isResolved?.(attempt) ?? false}
              />
            ))}
          </Lane>
        ))}
        {ongoing && start !== null && <LiveEdge left={LABEL_W + x(end)} />}
      </div>
    </div>
  )
}

function Axis({
  offsets,
  x,
}: {
  offsets: number[]
  x: (offset: number) => number
}) {
  const step = (offsets[1] ?? 0) - (offsets[0] ?? 0)
  return (
    <div className="flex border-b border-line">
      <div className="shrink-0" style={{ width: LABEL_W }} />
      <div className="relative h-6" style={{ width: WIDTH }}>
        {offsets.map((offset) => (
          <span
            key={offset}
            className="absolute top-1 -translate-x-1/2 text-xs text-ink-soft tabular-nums"
            style={{ left: x(offset) }}
          >
            {seconds(offset, step)}
          </span>
        ))}
      </div>
    </div>
  )
}

function Lane({
  deviceId,
  children,
}: {
  deviceId: string
  children: ReactNode
}) {
  return (
    <div
      data-testid="lane"
      data-device={deviceId}
      className="flex items-center border-b border-line last:border-b-0"
    >
      <div
        className="shrink-0 truncate pr-3 font-mono text-xs text-ink-soft"
        style={{ width: LABEL_W }}
      >
        {deviceId}
      </div>
      <div
        className="relative overflow-hidden"
        style={{ width: WIDTH, height: LANE_H }}
      >
        {children}
      </div>
    </div>
  )
}

function Bar({
  attempt,
  x,
  end,
  href,
  resolved,
}: {
  attempt: Attempt
  x: Scale
  end: number
  href: string | undefined
  resolved: boolean
}) {
  const start = attempt.startedAt ?? attempt.endedAt
  if (start === null) return null

  const left = x(start)
  const width = Math.max(
    Math.min(x(attempt.endedAt ?? end), WIDTH) - left,
    MIN_BAR_W,
  )
  const label =
    attempt.attempt > 1
      ? `${attempt.stepId} #${attempt.attempt}`
      : attempt.stepId
  const shared = {
    'data-testid': 'bar',
    'data-step': attempt.stepId,
    'data-attempt': attempt.attempt,
    'data-device': attempt.deviceId,
    'data-status': attempt.status,
    'data-refused': attempt.refused ? 'true' : 'false',
    'data-start': String(start),
    'data-end': attempt.endedAt === null ? '' : String(attempt.endedAt),
    title: `${attempt.stepId}, attempt ${attempt.attempt}: ${attempt.status}`,
    style: { left, width },
    className: `absolute top-1.5 h-7 truncate rounded px-2 text-xs leading-7 ${toneOf(attempt.status, resolved)}`,
  }

  if (href === undefined) return <div {...shared}>{label}</div>
  return (
    <a
      {...shared}
      href={href}
      aria-label={`${attempt.stepId}, attempt ${attempt.attempt}, ${attempt.status}. Show details.`}
      className={`${shared.className} cursor-pointer hover:brightness-110 focus-visible:outline-offset-[-2px] focus-visible:outline-ink`}
    >
      {label}
    </a>
  )
}

/** Marks the current time while instruments are working. */
function LiveEdge({ left }: { left: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 w-px -translate-x-px bg-running"
      style={{ left }}
    />
  )
}

function toneOf(status: AttemptStatus, resolved: boolean): string {
  return status === 'failed' && resolved ? RESOLVED_FAILURE_TONE : TONE[status]
}

const TONE: Record<AttemptStatus, string> = {
  dispatched: 'bg-waiting text-ink',
  running:
    'bg-running-soft text-ink [background-image:repeating-linear-gradient(45deg,transparent_0_5px,rgb(255_255_255/0.55)_5px_10px)]',
  done: 'bg-done-soft text-ink',
  failed: 'bg-failed text-white',
}

const RESOLVED_FAILURE_TONE =
  'bg-failed-soft text-failed ring-1 ring-inset ring-failed/35'

/** "0.5s" when the ticks are under a second apart, "12s" otherwise. */
function seconds(offsetMs: number, stepMs: number): string {
  const decimals = stepMs > 0 && stepMs < 1000 ? 1 : 0
  return `${(offsetMs / 1000).toFixed(decimals)}s`
}
