// The page header and the view of the current run. RunView is keyed per run,
// so its state, socket and pending retry requests are discarded when a new run
// starts.
import { useCallback, useState } from 'react'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { FailurePanel } from '../components/FailurePanel'
import { RunStatus } from '../components/RunStatus'
import { Timeline } from '../pages/Timeline'
import { createRun, startRun } from '../lib/api'
import { failureHref } from '../lib/failureAnchor'
import { pageTitle } from '../lib/pageTitle'
import {
  attemptKey,
  selectBlockedSince,
  selectConnection,
  selectFailures,
  selectRunStatus,
  selectTracks,
} from '../lib/runState'
import type { Attempt, Track } from '../lib/runState'
import { timeWindowOf } from '../lib/timeWindow'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useNow } from '../lib/useNow'
import { useRunState } from '../lib/useRunState'

type StartRequest = 'idle' | 'starting' | 'unreachable'

export function RunPage() {
  // Run ids repeat when the simulator restarts, so `session` is the identity.
  const [run, setRun] = useState<{ id: string; session: number } | null>(null)
  const [start, setStart] = useState<StartRequest>('idle')

  const onStart = useCallback(async () => {
    setStart('starting')
    try {
      const id = await createRun()
      setRun((previous) => ({ id, session: (previous?.session ?? 0) + 1 }))
      await startRun(id)
      setStart('idle')
    } catch {
      setStart('unreachable')
    }
  }, [])

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">Lab run monitor</h1>
        <div className="ml-auto flex items-center gap-3">
          {start === 'unreachable' && (
            <p role="alert" className="text-sm text-failed">
              Could not reach the lab. Is the simulator running?
            </p>
          )}
          <Button
            variant={run ? 'secondary' : 'primary'}
            data-testid="start-run"
            onClick={onStart}
            disabled={start === 'starting'}
          >
            {start === 'starting' ? 'Starting…' : 'Start a run'}
          </Button>
        </div>
      </header>
      {run ? <RunView key={run.session} runId={run.id} /> : <NoRunYet />}
    </div>
  )
}

function NoRunYet() {
  return (
    <p className="rounded-md border border-dashed border-line px-5 py-10 text-center text-sm text-ink-soft">
      No run yet. Start a run to see each instrument's steps on the timeline.
    </p>
  )
}

function RunView({ runId }: { runId: string }) {
  const state = useRunState(runId)
  const status = selectRunStatus(state)
  const connection = selectConnection(state)
  const failures = selectFailures(state)
  useDocumentTitle(pageTitle(runId, status, connection.status))

  const retried = new Set(
    failures.flatMap(({ attempt, retriedBy }) =>
      retriedBy === null ? [] : [attemptKey(attempt)],
    ),
  )
  const isResolved = (attempt: Attempt) => retried.has(attemptKey(attempt))
  const linkToFailure = (attempt: Attempt) =>
    attempt.status === 'failed' ? failureHref(runId, attempt) : undefined

  return (
    <main className="space-y-4">
      <RunStatus
        runId={runId}
        status={status}
        blockedSince={selectBlockedSince(state)}
      />
      <Banner connection={connection} />
      <section
        aria-label="Timeline"
        className="rounded-md border border-line bg-surface px-4 py-3"
      >
        <LiveTimeline
          tracks={selectTracks(state)}
          hrefFor={linkToFailure}
          isResolved={isResolved}
        />
      </section>
      <FailurePanel runId={runId} failures={failures} />
    </main>
  )
}

/** Renders the timeline and owns its clock, so only the timeline re-renders on
 *  each tick. The clock ticks only while an instrument is working; otherwise
 *  the axis ends at the last reported time. */
function LiveTimeline({
  tracks,
  hrefFor,
  isResolved,
}: {
  tracks: Track[]
  hrefFor: (attempt: Attempt) => string | undefined
  isResolved: (attempt: Attempt) => boolean
}) {
  const { start, lastReport, ongoing } = timeWindowOf(tracks)
  const now = useNow(ongoing)
  const reported = lastReport ?? now
  // Right after the clock restarts, `now` can be older than the event that
  // restarted it.
  const end = ongoing ? Math.max(now, reported) : reported

  return (
    <Timeline
      tracks={tracks}
      start={start}
      end={end}
      ongoing={ongoing}
      hrefFor={hrefFor}
      isResolved={isResolved}
    />
  )
}
