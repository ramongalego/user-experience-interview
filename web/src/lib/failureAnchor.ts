// Element ids for failure cards, so timeline bars can link to them.
import type { Attempt } from './runState'

type AttemptIdentity = Pick<Attempt, 'stepId' | 'attempt'>

/** Includes the run id, so a hash left in the URL by an earlier run does not
 *  match a card in the next one. */
export function failureAnchor(runId: string, attempt: AttemptIdentity): string {
  return `failure-${runId}-${attempt.stepId}-${attempt.attempt}`
}

export function failureHref(runId: string, attempt: AttemptIdentity): string {
  return `#${encodeURIComponent(failureAnchor(runId, attempt))}`
}
