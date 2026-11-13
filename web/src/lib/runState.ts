// Everything the screen shows is derived from this state. It is fed by a
// snapshot and by a stream of events that can arrive late, twice or out of
// order.
//
// The result does not depend on arrival order. Each event is a fact about one
// attempt, and merging facts only adds information: status only moves forward
// and each timestamp is set once. Sequence numbers are not used to reorder
// events. They are used to drop duplicates, track where to resume, and detect
// missing events.
//
// Plain TypeScript with no React, so the tests can call it directly.
import { DEVICES } from './types'
import type {
  EventType,
  GapFrame,
  LabEvent,
  Snapshot,
  StepError,
  StepSnapshot,
} from './types'

export type AttemptStatus = 'dispatched' | 'running' | 'done' | 'failed'

/** One attempt of a step on its device. */
export interface Attempt {
  stepId: string
  attempt: number
  deviceId: string
  status: AttemptStatus
  refused: boolean
  /** Epoch ms, or null while the instrument has not confirmed it started. */
  startedAt: number | null
  /** Epoch ms, or null while it is still running. Only set from a reported
   *  end, never estimated. */
  endedAt: number | null
  /** Why it failed, when it did. Null otherwise. */
  error: StepError | null
}

export interface Track {
  deviceId: string
  attempts: Attempt[]
}

export interface Failure {
  attempt: Attempt
  /** The attempt that replaced this one, once the stream has shown it. */
  retriedBy: Attempt | null
  /** Every step that cannot start until this one succeeds, in workflow order.
   *  Null while the workflow is unknown: no snapshot has described it yet. */
  holdsUp: string[] | null
}

export type ConnectionStatus = 'connecting' | 'live' | 'stale' | 'gap'

export interface Connection {
  status: ConnectionStatus
  /** Highest sequence number applied so far. */
  lastSeq: number
  /** Shown to the user when the status is not 'live'. */
  note?: string
}

/** An attempt is known from its first mention, which can be a refusal that
 *  comes before any dispatch. */
type AttemptRecord = Omit<Attempt, 'status'> & {
  status: AttemptStatus | 'pending'
}

export interface RunState {
  /** The run this state belongs to. Null accepts events for any run. */
  runId: string | null
  /** The most recent run status, and the seq it came from. */
  run: { status: string; seq: number }
  attempts: Readonly<Record<string, AttemptRecord>>
  /** What each step depends on, in workflow order, as the snapshot describes
   *  it. Events never mention dependencies, so this only comes from there. */
  dependsOn: Readonly<Record<string, readonly string[]>>
  /** Every seq up to here is accounted for. A reconnect resumes from it. */
  lastSeq: number
  /** Seqs applied past lastSeq while an earlier one is still missing. */
  ahead: ReadonlySet<number>
  socket: 'connecting' | 'open' | 'closed'
  /** The server could not replay part of the run. Never cleared. */
  gapped: boolean
}

/** How many events can arrive after a missing one before the connection is
 *  reported as having a gap. */
const REORDER_WINDOW = 8

const MISSING_NOTE =
  'Some events have not arrived. Part of this run may be missing.'

const STAGE: Record<AttemptRecord['status'], number> = {
  pending: 0,
  dispatched: 1,
  running: 2,
  done: 3,
  failed: 3,
}

/** A dispatch counts as evidence the run is moving: nothing on the wire says a
 *  blocked run has resumed. */
const RUN_STATUS: Partial<Record<EventType, string>> = {
  'step.dispatched': 'running',
  'step.started': 'running',
  'run.blocked': 'blocked',
  'run.completed': 'completed',
}

export function createRunState(runId: string | null = null): RunState {
  return {
    runId,
    run: { status: 'unknown', seq: 0 },
    attempts: {},
    dependsOn: {},
    lastSeq: 0,
    ahead: new Set(),
    socket: 'connecting',
    gapped: false,
  }
}

/** Fold in a snapshot. It covers every event up to snap.seq. */
export function applySnapshot(state: RunState, snap: Snapshot): RunState {
  const attempts = { ...state.attempts }
  for (const step of snap.run.steps) {
    const facts = factsOfRow(step)
    if (!facts) continue
    const key = attemptKey({ stepId: step.id, attempt: step.attempt })
    const known =
      attempts[key] ?? unheardOf(step.id, step.attempt, step.device_id)
    attempts[key] = merge(known, facts)
  }
  return {
    ...state,
    attempts,
    dependsOn: { ...state.dependsOn, ...dependenciesOf(snap.run.steps) },
    run: latest(state.run, { status: snap.run.status, seq: snap.seq }),
    ...settle(Math.max(state.lastSeq, snap.seq), state.ahead),
  }
}

/** Fold in one frame from the socket. Frames that are neither a gap nor a
 *  sequenced event are ignored. */
export function applyMessage(state: RunState, msg: unknown): RunState {
  if (isGapFrame(msg)) return applyGap(state, msg)
  if (isLabEvent(msg)) return applyEvent(state, msg)
  return state
}

/** Fold in one already-typed event. */
export function applyEvent(state: RunState, e: LabEvent): RunState {
  if (state.runId !== null && e.run_id !== state.runId) return state
  if (e.seq <= state.lastSeq || state.ahead.has(e.seq)) return state
  return {
    ...state,
    run: runAfter(state.run, e),
    attempts: attemptsAfter(state.attempts, e),
    ...settle(state.lastSeq, [...state.ahead, e.seq]),
  }
}

/** Fold in a transport change: the socket opened, or it went away. */
export function applyTransport(
  state: RunState,
  kind: 'open' | 'closed',
): RunState {
  return state.socket === kind ? state : { ...state, socket: kind }
}

/** One track per device: DEVICES first, in order, then any device the stream
 *  has mentioned that DEVICES does not know. Overlapping attempts on one track
 *  are physically impossible -- an instrument does one thing at a time. */
export function selectTracks(state: RunState): Track[] {
  const lanes = new Map<string, Attempt[]>(DEVICES.map((d) => [d, []]))
  for (const attempt of occupancies(state)) {
    const lane = lanes.get(attempt.deviceId)
    if (lane) lane.push(attempt)
    else lanes.set(attempt.deviceId, [attempt])
  }
  return Array.from(lanes, ([deviceId, attempts]) => ({ deviceId, attempts }))
}

/** Every failed attempt, oldest first. One with no retry is still open. */
export function selectFailures(state: RunState): Failure[] {
  const all = occupancies(state)
  return all
    .filter((a) => a.status === 'failed')
    .map((failed) => ({
      attempt: failed,
      retriedBy:
        all.find(
          (a) => a.stepId === failed.stepId && a.attempt > failed.attempt,
        ) ?? null,
      holdsUp: stepsWaitingOn(state.dependsOn, failed.stepId),
    }))
}

export function selectRunStatus(state: RunState): string {
  return state.run.status
}

/** When a blocked run started waiting on someone: the end of its oldest
 *  failure that has not been retried. Null when the run is not blocked, or
 *  when no such failure has been reported (it may have been lost in a gap). */
export function selectBlockedSince(state: RunState): number | null {
  if (selectRunStatus(state) !== 'blocked') return null
  const openFailureTimes = selectFailures(state).flatMap(
    ({ attempt, retriedBy }) =>
      retriedBy === null && attempt.endedAt !== null ? [attempt.endedAt] : [],
  )
  return openFailureTimes.length > 0 ? Math.min(...openFailureTimes) : null
}

/** A closed socket is reported before a gap. It is the more urgent problem,
 *  and the gap is still reported once the socket reconnects. */
export function selectConnection(state: RunState): Connection {
  const { socket, gapped, ahead, lastSeq } = state
  if (socket === 'closed') return { status: 'stale', lastSeq }
  if (gapped) return { status: 'gap', lastSeq }
  if (ahead.size > REORDER_WINDOW)
    return { status: 'gap', lastSeq, note: MISSING_NOTE }
  return { status: socket === 'open' ? 'live' : 'connecting', lastSeq }
}

/** What to ask the server to resume from on the next connection attempt. */
export function selectResumeFrom(state: RunState): number {
  return state.lastSeq
}

function applyGap(state: RunState, gap: GapFrame): RunState {
  return {
    ...state,
    gapped: true,
    ...settle(Math.max(state.lastSeq, gap.earliest - 1), state.ahead),
  }
}

function runAfter(run: RunState['run'], e: LabEvent): RunState['run'] {
  const status = RUN_STATUS[e.type]
  return status ? latest(run, { status, seq: e.seq }) : run
}

function attemptsAfter(
  attempts: RunState['attempts'],
  e: LabEvent,
): RunState['attempts'] {
  const facts = factsOf(e)
  if (!facts || !e.step_id || !e.attempt || !e.device_id) return attempts
  const key = attemptKey({ stepId: e.step_id, attempt: e.attempt })
  const known = attempts[key] ?? unheardOf(e.step_id, e.attempt, e.device_id)
  return { ...attempts, [key]: merge(known, facts) }
}

/** What one event says about its attempt. Null for run-level events and for
 *  events this code cannot read (unknown type, unparseable time). Their seq
 *  still counts as received; otherwise every new event type would look like a
 *  lost event. */
function factsOf(e: LabEvent): Partial<AttemptRecord> | null {
  const at = Date.parse(e.at)
  if (Number.isNaN(at)) return null
  switch (e.type) {
    case 'step.refused':
      return { refused: true }
    case 'step.dispatched':
      return { status: 'dispatched' }
    case 'step.started':
      return { status: 'running', startedAt: at }
    case 'step.finished':
      return { status: 'done', endedAt: at }
    case 'step.failed':
      return { status: 'failed', endedAt: at, error: e.error ?? null }
    default:
      return null
  }
}

/** What a snapshot row says about its step's latest attempt. Null for a step
 *  that is pending: nothing has been dispatched, so there is no attempt yet. */
function factsOfRow(step: StepSnapshot): Partial<AttemptRecord> | null {
  if (!isAttemptStatus(step.status)) return null
  return {
    status: step.status,
    startedAt: toMs(step.started_at),
    endedAt: toMs(step.ended_at),
    error: step.error,
  }
}

function dependenciesOf(
  steps: StepSnapshot[],
): Record<string, readonly string[]> {
  return Object.fromEntries(
    steps.map((step) => [step.id, step.depends_on ?? []]),
  )
}

/** Every step downstream of `stepId`, directly or through another step, in
 *  workflow order. Null when the workflow does not know the step. */
function stepsWaitingOn(
  dependsOn: RunState['dependsOn'],
  stepId: string,
): string[] | null {
  if (!Object.hasOwn(dependsOn, stepId)) return null
  const waiting = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const [step, deps] of Object.entries(dependsOn)) {
      if (waiting.has(step)) continue
      if (deps.some((dep) => dep === stepId || waiting.has(dep))) {
        waiting.add(step)
        grew = true
      }
    }
  }
  return Object.keys(dependsOn).filter((step) => waiting.has(step))
}

/** Commutative and idempotent, which is what makes arrival order irrelevant. */
function merge(
  known: AttemptRecord,
  facts: Partial<AttemptRecord>,
): AttemptRecord {
  const { status } = facts
  return {
    ...known,
    status:
      status && STAGE[status] > STAGE[known.status] ? status : known.status,
    refused: known.refused || facts.refused === true,
    startedAt: known.startedAt ?? facts.startedAt ?? null,
    endedAt: known.endedAt ?? facts.endedAt ?? null,
    error: known.error ?? facts.error ?? null,
  }
}

function unheardOf(
  stepId: string,
  attempt: number,
  deviceId: string,
): AttemptRecord {
  return {
    stepId,
    attempt,
    deviceId,
    status: 'pending',
    refused: false,
    startedAt: null,
    endedAt: null,
    error: null,
  }
}

/** Sets lastSeq to `floor`, then advances it past any received seqs that are
 *  now contiguous. */
function settle(
  floor: number,
  heardAhead: Iterable<number>,
): Pick<RunState, 'lastSeq' | 'ahead'> {
  const ahead = new Set<number>()
  for (const seq of heardAhead) if (seq > floor) ahead.add(seq)
  let lastSeq = floor
  while (ahead.delete(lastSeq + 1)) lastSeq++
  return { lastSeq, ahead }
}

function latest(a: RunState['run'], b: RunState['run']): RunState['run'] {
  return b.seq >= a.seq ? b : a
}

/** Every attempt that has reached a device, oldest first. */
function occupancies(state: RunState): Attempt[] {
  return Object.values(state.attempts).filter(isOnTrack).sort(chronologically)
}

function chronologically(a: Attempt, b: Attempt): number {
  return (
    when(a) - when(b) ||
    a.stepId.localeCompare(b.stepId) ||
    a.attempt - b.attempt
  )
}

function when(a: Attempt): number {
  return a.startedAt ?? a.endedAt ?? Number.MAX_SAFE_INTEGER
}

/** One attempt's identity: a step can run more than once. */
export function attemptKey({
  stepId,
  attempt,
}: Pick<Attempt, 'stepId' | 'attempt'>): string {
  return `${stepId}#${attempt}`
}

function toMs(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso)
}

function isOnTrack(a: AttemptRecord): a is Attempt {
  return a.status !== 'pending'
}

function isAttemptStatus(status: string): status is AttemptStatus {
  return status !== 'pending' && Object.hasOwn(STAGE, status)
}

function isGapFrame(msg: unknown): msg is GapFrame {
  return isRecord(msg) && msg.type === 'gap' && Number.isInteger(msg.earliest)
}

function isLabEvent(msg: unknown): msg is LabEvent {
  return (
    isRecord(msg) &&
    Number.isInteger(msg.seq) &&
    typeof msg.type === 'string' &&
    typeof msg.at === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export type { LabEvent, Snapshot, StepError }
