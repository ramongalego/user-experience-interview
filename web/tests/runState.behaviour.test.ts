// What the state layer promises beyond the replay gates.
import { describe, expect, test } from 'vitest'
import fixture from './fixtures/run-with-retry.json'
import {
  applyMessage,
  applySnapshot,
  applyTransport,
  createRunState,
  selectBlockedSince,
  selectConnection,
  selectFailures,
  selectResumeFrom,
  selectRunStatus,
  selectTracks,
} from '../src/lib/runState'
import type { LabEvent, RunState, Snapshot } from '../src/lib/runState'

const RUN = fixture as unknown as LabEvent[]
const LAST_SEQ = RUN.length
const FAILED_AT = RUN.findIndex((e) => e.type === 'step.failed') + 1
const BLOCKED_AT = RUN.findIndex((e) => e.type === 'run.blocked') + 1

const fold = (frames: unknown[], from = createRunState()): RunState =>
  frames.reduce<RunState>((state, frame) => applyMessage(state, frame), from)

const live = () => applyTransport(createRunState(), 'open')

const without = (seq: number) => RUN.filter((e) => e.seq !== seq)

/** Everything the screen draws from. */
const screen = (state: RunState) => ({
  tracks: selectTracks(state),
  failures: selectFailures(state),
  run: selectRunStatus(state),
  resumeFrom: selectResumeFrom(state),
})

describe('arrival order', () => {
  test('every order, with any repetition, lands on the same screen', () => {
    const expected = screen(fold(RUN))
    for (let seed = 1; seed <= 200; seed++) {
      const random = prng(seed)
      const repeats = RUN.filter(() => random() < 0.3)
      const delivered = shuffle([...RUN, ...repeats], random)
      expect(screen(fold(delivered)), `seed ${seed}`).toEqual(expected)
    }
  })

  test('a frame that changes nothing returns the same state', () => {
    const state = fold(RUN)
    expect(applyMessage(state, RUN[4])).toBe(state)
  })
})

describe('a missing event', () => {
  test('holds the resume position, so a reconnect asks for it again', () => {
    expect(selectResumeFrom(fold(without(11)))).toBe(10)
  })

  test('completes the record again when it arrives late', () => {
    const missing = fold(without(11), live())
    expect(selectConnection(missing).status).toBe('gap')

    const healed = applyMessage(missing, RUN[10])
    expect(selectConnection(healed).status).toBe('live')
    expect(selectResumeFrom(healed)).toBe(LAST_SEQ)
  })
})

describe('a gap frame', () => {
  const gap = { type: 'gap', from: 10, earliest: 20 }

  test('moves the resume position to where the replay picks up', () => {
    const state = fold([...RUN.slice(0, 10), gap, ...RUN.slice(19)], live())
    expect(selectResumeFrom(state)).toBe(LAST_SEQ)
    expect(selectConnection(state).status).toBe('gap')
  })

  test('is outranked by a disconnect, and still there afterwards', () => {
    const gapped = fold([...RUN.slice(0, 10), gap], live())
    const dropped = applyTransport(gapped, 'closed')
    expect(selectConnection(dropped).status).toBe('stale')
    expect(selectConnection(applyTransport(dropped, 'open')).status).toBe('gap')
  })
})

describe('frames it cannot use', () => {
  test.each([
    ['of an unknown type', { type: 'step.paused' }],
    ['with a time that will not parse', { at: 'soon' }],
  ])('an event %s is counted as heard, and no more', (_, oddity) => {
    const known = fold(RUN, live())
    const unreadable = { ...RUN[1], seq: LAST_SEQ + 1, ...oddity }
    const state = applyMessage(known, unreadable)

    expect(selectResumeFrom(state)).toBe(LAST_SEQ + 1)
    expect(selectConnection(state).status).toBe('live')
    expect(selectTracks(state)).toEqual(selectTracks(known))
  })

  test.each([null, 'gap', 42, [], {}, { type: 'gap' }, { seq: '7' }])(
    '%j changes nothing',
    (junk) => {
      const state = fold(RUN.slice(0, 10))
      expect(applyMessage(state, junk)).toBe(state)
    },
  )

  test('an event for another run is not ours, and uses up no seq', () => {
    const ours = fold(RUN.slice(0, 10), createRunState('r-1'))
    const stray = { ...RUN[10], run_id: 'r-2' }

    expect(applyMessage(ours, stray)).toBe(ours)
    expect(selectResumeFrom(fold([stray, RUN[10]], ours))).toBe(11)
  })
})

describe('a step and a device nobody listed', () => {
  test('get a bar on a track of their own', () => {
    const spin = (seq: number, type: string) => ({
      ...RUN[0],
      seq,
      type,
      step_id: 'spin_down',
      device_id: 'centrifuge-1',
    })
    const tracks = selectTracks(
      fold([...RUN, spin(29, 'step.dispatched'), spin(30, 'step.started')]),
    )

    expect(tracks.map((t) => t.deviceId)).toEqual([
      'liquid-handler-1',
      'incubator-1',
      'plate-reader-1',
      'centrifuge-1',
    ])
    expect(tracks[3]!.attempts).toMatchObject([
      { stepId: 'spin_down', attempt: 1, status: 'running', endedAt: null },
    ])
  })
})

describe('a snapshot', () => {
  const snapshot: Snapshot = {
    seq: 5,
    run: {
      id: 'r-1',
      status: 'running',
      steps: [
        step('fill_sample_plate', 'liquid-handler-1', 'done', RUN[1]!.at),
        step('incubate_samples', 'incubator-1', 'dispatched'),
        step('combine', 'liquid-handler-1', 'pending', null, 0),
      ],
    },
  }

  test('draws only the steps that have reached a device', () => {
    const tracks = selectTracks(applySnapshot(createRunState(), snapshot))
    expect(tracks.flatMap((t) => t.attempts).map((a) => a.stepId)).toEqual([
      'fill_sample_plate',
      'incubate_samples',
    ])
  })

  test('older than the stream takes nothing away', () => {
    const ahead = fold(RUN)
    expect(screen(applySnapshot(ahead, snapshot))).toEqual(screen(ahead))
  })
})

describe('failures', () => {
  test('one is open until the stream shows its retry', () => {
    const [open] = selectFailures(fold(RUN.slice(0, FAILED_AT)))
    expect(open).toMatchObject({
      attempt: { stepId: 'warm_reagent_plate', attempt: 1 },
      retriedBy: null,
    })

    const [retried] = selectFailures(fold(RUN))
    expect(retried!.retriedBy).toMatchObject({ attempt: 2, status: 'done' })
  })

  test('say which steps they hold up, once the workflow is known', () => {
    const failedRun = RUN.slice(0, FAILED_AT)
    const [unknown] = selectFailures(fold(failedRun))
    expect(unknown!.holdsUp, 'no snapshot has described the workflow').toBe(
      null,
    )

    const described = applySnapshot(createRunState(), WORKFLOW)
    const [known] = selectFailures(fold(failedRun, described))
    expect(known!.holdsUp, 'directly, and through combine').toEqual([
      'combine',
      'read_plate',
    ])
  })

  test('at the end of the workflow hold nothing up', () => {
    const described = applySnapshot(createRunState(), WORKFLOW)
    const lastStep = {
      seq: 1,
      run_id: 'r-1',
      type: 'step.failed',
      at: RUN[0]!.at,
      step_id: 'read_plate',
      attempt: 1,
      device_id: 'plate-reader-1',
    }
    const [failure] = selectFailures(applyMessage(described, lastStep))
    expect(failure!.holdsUp).toEqual([])
  })
})

describe('run status', () => {
  test('a dispatched retry unblocks the run', () => {
    expect(selectRunStatus(fold(RUN.slice(0, BLOCKED_AT)))).toBe('blocked')
    expect(selectRunStatus(fold(RUN.slice(0, BLOCKED_AT + 1)))).toBe('running')
    expect(selectRunStatus(fold(RUN))).toBe('completed')
  })
})

describe('how long a run has been blocked', () => {
  const failed = RUN[FAILED_AT - 1]!

  test('is counted from the failure that blocked it', () => {
    const blocked = fold(RUN.slice(0, BLOCKED_AT))
    expect(selectBlockedSince(blocked)).toBe(Date.parse(failed.at))
  })

  test('is not counted while the run is not blocked', () => {
    expect(selectBlockedSince(fold(RUN.slice(0, FAILED_AT))), 'failed').toBe(
      null,
    )
    expect(
      selectBlockedSince(fold(RUN.slice(0, BLOCKED_AT + 1))),
      'retried',
    ).toBe(null)
    expect(selectBlockedSince(fold(RUN)), 'completed').toBe(null)
  })

  test('is not guessed when the failure itself was never received', () => {
    const lost = RUN.slice(0, BLOCKED_AT).filter((e) => e.seq !== failed.seq)
    const state = fold(lost)
    expect(selectRunStatus(state)).toBe('blocked')
    expect(selectBlockedSince(state)).toBe(null)
  })
})

/** The default workflow before anything has run: every step pending. */
const WORKFLOW = workflowSnapshot({
  fill_sample_plate: [],
  incubate_samples: ['fill_sample_plate'],
  fill_reagent_plate: ['fill_sample_plate'],
  fill_buffer_plate: ['fill_sample_plate'],
  warm_reagent_plate: ['fill_reagent_plate'],
  combine: ['incubate_samples', 'warm_reagent_plate', 'fill_buffer_plate'],
  read_plate: ['combine'],
})

function workflowSnapshot(dependsOn: Record<string, string[]>): Snapshot {
  const steps = Object.entries(dependsOn).map(([id, deps]) => ({
    ...step(id, 'any-device', 'pending', null, 0),
    depends_on: deps,
  }))
  return { seq: 0, run: { id: 'r-1', status: 'running', steps } }
}

function step(
  id: string,
  device_id: string,
  status: string,
  at: string | null = null,
  attempt = 1,
) {
  return {
    id,
    device_id,
    depends_on: null,
    status,
    attempt,
    started_at: at,
    ended_at: at,
    error: null,
  }
}

function prng(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}
