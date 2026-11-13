// Shows each failed attempt and what the operator can do about it.
//
// A failure needs action only while it is the latest attempt of its step. Once
// the stream shows a later attempt, the failure collapses into a one-line
// summary that can be expanded.
//
// Each open failure has one primary action. If the instrument reports the fault
// as retryable, that is Retry. If not, a retry would fail the same way, so the
// primary action is copying a report for whoever maintains the instrument.
import { Fragment, useEffect, useState } from 'react'
import { Badge } from './Badge'
import { Button } from './Button'
import { retryStep } from '../lib/api'
import { failureAnchor } from '../lib/failureAnchor'
import { attemptKey } from '../lib/runState'
import type { ReactNode } from 'react'
import type { RetryOutcome } from '../lib/api'
import type { Attempt, Failure, StepError } from '../lib/runState'

export function FailurePanel({
  runId,
  failures,
}: {
  runId: string
  failures: Failure[]
}) {
  const open = failures.filter((failure) => failure.retriedBy === null)
  const retried = failures.flatMap(({ attempt, retriedBy }) =>
    retriedBy === null ? [] : [{ failed: attempt, retriedBy }],
  )
  if (failures.length === 0) return null

  return (
    <section aria-label="Failures" className="space-y-3">
      {open.map((failure) => (
        <OpenFailure
          key={attemptKey(failure.attempt)}
          runId={runId}
          failure={failure}
        />
      ))}
      {retried.map(({ failed, retriedBy }) => (
        <RetriedFailure
          key={attemptKey(failed)}
          runId={runId}
          failed={failed}
          retriedBy={retriedBy}
        />
      ))}
    </section>
  )
}

function OpenFailure({ runId, failure }: { runId: string; failure: Failure }) {
  const { attempt: failed, holdsUp } = failure
  // With no error reported we can't tell, so offer the retry and let the
  // server decide.
  const retryable = failed.error?.retryable !== false

  return (
    <article
      id={failureAnchor(runId, failed)}
      data-testid="failure"
      data-step={failed.stepId}
      data-attempt={failed.attempt}
      className="scroll-mt-6 overflow-hidden rounded-md border border-failed/30 bg-surface target:ring-2 target:ring-failed/40"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-failed/15 bg-failed-soft px-5 py-3">
        <h2 className="font-semibold">
          <span className="font-mono">{failed.stepId}</span> failed
        </h2>
        <AttemptLine attempt={failed} className="text-failed-ink" />
      </header>

      <div className="space-y-5 px-5 py-4">
        <Report error={failed.error} deviceId={failed.deviceId} />
        <div className="space-y-3">
          <HoldsUp steps={holdsUp} />
          {retryable ? (
            <RetryActions runId={runId} failed={failed} holdsUp={holdsUp} />
          ) : (
            <HandOffActions runId={runId} failed={failed} holdsUp={holdsUp} />
          )}
        </div>
      </div>
    </article>
  )
}

function RetriedFailure({
  runId,
  failed,
  retriedBy,
}: {
  runId: string
  failed: Attempt
  retriedBy: Attempt
}) {
  return (
    <details
      id={failureAnchor(runId, failed)}
      data-testid="retried-failure"
      data-step={failed.stepId}
      data-attempt={failed.attempt}
      className="group scroll-mt-6 rounded-md border border-line bg-surface target:ring-2 target:ring-failed/40"
    >
      <summary className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden gap-2 px-5 py-2.5 text-sm text-ink-soft">
        <Chevron />
        <span>
          <span className="font-mono text-ink">{failed.stepId}</span> failed on
          attempt {failed.attempt}, retried as attempt {retriedBy.attempt}
        </span>
        <Badge tone={retriedBy.status}>{retriedBy.status}</Badge>
      </summary>
      <div className="space-y-3 border-t border-line px-5 py-4">
        <AttemptLine attempt={failed} />
        <Report error={failed.error} deviceId={failed.deviceId} />
      </div>
    </details>
  )
}

/** Drawn by hand because a flex `<summary>` loses the native marker. */
function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90"
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AttemptLine({
  attempt,
  className = 'text-ink-soft',
}: {
  attempt: Attempt
  className?: string
}) {
  return (
    <p className={`text-sm ${className}`}>
      Attempt {attempt.attempt} on{' '}
      <span className="font-mono">{attempt.deviceId}</span>
      {attempt.endedAt !== null && (
        <>
          {' at '}
          <time
            dateTime={new Date(attempt.endedAt).toISOString()}
            className="tabular-nums"
          >
            {new Date(attempt.endedAt).toLocaleTimeString()}
          </time>
        </>
      )}
    </p>
  )
}

/** The instrument's error report. The keys in `context` differ by instrument
 *  and fault and are not listed anywhere, so they are shown as sent. */
function Report({
  error,
  deviceId,
}: {
  error: StepError | null
  deviceId: string
}) {
  if (!error) return <p className="text-sm">No reason was reported.</p>
  const context = Object.entries(error.context ?? {})

  return (
    <div className="space-y-3">
      <p className="flex max-w-prose flex-wrap items-baseline gap-x-3 gap-y-1">
        <span>{error.detail}</span>
        <code className="font-mono text-xs text-failed">{error.code}</code>
      </p>
      {/* Usually the device the step ran on, which the header already shows. */}
      {error.instrument !== deviceId && (
        <p className="text-sm text-ink-soft">
          Reported by <span className="font-mono">{error.instrument}</span>
        </p>
      )}
      {context.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 font-mono text-xs tabular-nums">
          {context.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-ink-soft">{key}</dt>
              <dd className="break-words">{show(value)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Which later steps this failure blocks. Renders nothing until a snapshot
 *  has described the workflow. */
function HoldsUp({ steps }: { steps: string[] | null }) {
  if (steps === null) return null
  if (steps.length === 0)
    return (
      <p className="max-w-prose text-sm">
        The run cannot finish until this step succeeds.
      </p>
    )
  return (
    <p className="max-w-prose text-sm">
      <StepList steps={steps} /> {steps.length === 1 ? 'is' : 'are'} waiting on
      this step.
    </p>
  )
}

type RetryRequest = { kind: 'idle' } | { kind: 'sending' } | RetryOutcome

/** The retry button and the result of the request. An accepted request only
 *  means the retry is queued. The new attempt shows up when the stream reports
 *  it, and this card is replaced at that point. */
function RetryActions({
  runId,
  failed,
  holdsUp,
}: {
  runId: string
  failed: Attempt
  holdsUp: string[] | null
}) {
  const [request, setRequest] = useState<RetryRequest>({ kind: 'idle' })

  const send = async () => {
    setRequest({ kind: 'sending' })
    setRequest(await retryStep(runId, failed.stepId, failed.attempt))
  }

  const report = <CopyReport runId={runId} failed={failed} holdsUp={holdsUp} />

  if (request.kind === 'accepted')
    return (
      <Actions secondary={report}>
        <p role="status" className="text-sm">
          <strong>Retry accepted.</strong> Attempt {request.attempt} is queued
          and will appear on the timeline when the instrument starts it.
        </p>
      </Actions>
    )

  if (request.kind === 'refused')
    return (
      <Actions secondary={report}>
        <p role="alert" className="text-sm">
          <strong>Not retried.</strong> {request.reason}
        </p>
      </Actions>
    )

  return (
    <div className="space-y-2">
      <Actions secondary={report}>
        <Button
          variant="primary"
          data-testid="retry-step"
          onClick={send}
          disabled={request.kind === 'sending'}
        >
          {request.kind === 'sending' ? 'Requesting retry…' : 'Retry step'}
        </Button>
      </Actions>
      {request.kind === 'unconfirmed' ? (
        <p role="alert" className="max-w-prose text-sm">
          <strong>No answer from the lab.</strong> The retry may not have been
          received. Trying again is safe: it cannot run the step twice.
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          Runs this step again as attempt {failed.attempt + 1}.
        </p>
      )}
    </div>
  )
}

/** Shown when the instrument reports the fault as not retryable. There is no
 *  retry button; the primary action copies a report for whoever can fix the
 *  instrument. */
function HandOffActions({
  runId,
  failed,
  holdsUp,
}: {
  runId: string
  failed: Attempt
  holdsUp: string[] | null
}) {
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm">
        <strong>Retrying will not help.</strong> The instrument will fail the
        same way until someone fixes the cause.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CopyReport
          runId={runId}
          failed={failed}
          holdsUp={holdsUp}
          variant="primary"
        />
        <p className="text-sm text-ink-soft">
          Paste it into a ticket or a message to whoever looks after this
          instrument.
        </p>
      </div>
    </div>
  )
}

/** Lays out the primary action (or its result) followed by the secondary one. */
function Actions({
  children,
  secondary,
}: {
  children: ReactNode
  secondary: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {children}
      {secondary}
    </div>
  )
}

type CopyState = 'idle' | 'copied' | 'failed'

const COPY_LABEL: Record<CopyState, string> = {
  idle: 'Copy report',
  copied: 'Copied',
  failed: 'Could not copy',
}

/** How long the button shows "Copied" before going back to "Copy report". */
const COPY_FEEDBACK_MS = 2000

function CopyReport({
  runId,
  failed,
  holdsUp,
  variant = 'secondary',
}: {
  runId: string
  failed: Attempt
  holdsUp: string[] | null
  variant?: 'primary' | 'secondary'
}) {
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(describe(runId, failed, holdsUp))
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <Button variant={variant} onClick={copy}>
      <span aria-live="polite">{COPY_LABEL[state]}</span>
    </Button>
  )
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <>
      {LIST_FORMAT.formatToParts(steps).map((part, i) =>
        part.type === 'element' ? (
          <span key={i} className="font-mono">
            {part.value}
          </span>
        ) : (
          part.value
        ),
      )}
    </>
  )
}

const LIST_FORMAT = new Intl.ListFormat('en', { type: 'conjunction' })

/** Plain-text report for pasting into a ticket or message. */
function describe(
  runId: string,
  failed: Attempt,
  holdsUp: string[] | null,
): string {
  const { error } = failed
  return [
    `${failed.stepId} failed (run ${runId}, attempt ${failed.attempt}, ${failed.deviceId})`,
    failed.endedAt !== null && new Date(failed.endedAt).toISOString(),
    error && `${error.code}: ${error.detail}`,
    error && `Retryable: ${error.retryable ? 'yes' : 'no'}`,
    holdsUp && holdsUp.length > 0 && `Waiting on it: ${holdsUp.join(', ')}`,
    ...Object.entries(error?.context ?? {}).map(
      ([key, value]) => `${key}: ${show(value)}`,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

function show(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value)
}
