// When the timeline keeps time, and when it stops.
import { describe, expect, test } from 'vitest'
import { ticks } from '../src/lib/scale'
import { timeWindowOf } from '../src/lib/timeWindow'
import type { Attempt, Track } from '../src/lib/runState'

const T0 = Date.parse('2026-11-12T22:00:00Z')

describe('the time window', () => {
  test('is empty before anything has happened', () => {
    expect(timeWindowOf([lane()])).toEqual({
      start: null,
      lastReport: null,
      ongoing: false,
    })
  })

  test('keeps running while an instrument is working', () => {
    const window = timeWindowOf([
      lane(attempt({ status: 'done', startedAt: T0, endedAt: T0 + 2000 })),
      lane(attempt({ status: 'running', startedAt: T0 + 2000 })),
    ])
    expect(window).toEqual({
      start: T0,
      lastReport: T0 + 2000,
      ongoing: true,
    })
  })

  test('counts a dispatch the instrument has not confirmed as work', () => {
    const window = timeWindowOf([lane(attempt({ status: 'dispatched' }))])
    expect(window.ongoing).toBe(true)
  })

  test('stops at the last report once nothing is working', () => {
    const window = timeWindowOf([
      lane(attempt({ status: 'done', startedAt: T0, endedAt: T0 + 2000 })),
      lane(
        attempt({ status: 'failed', startedAt: T0 + 2000, endedAt: T0 + 5000 }),
      ),
    ])
    expect(window).toEqual({
      start: T0,
      lastReport: T0 + 5000,
      ongoing: false,
    })
  })
})

describe('axis ticks', () => {
  test('land on round seconds of the run, not of the wall clock', () => {
    const start = T0 + 437
    expect(ticks(start, start + 10_000)).toEqual([
      0, 2000, 4000, 6000, 8000, 10_000,
    ])
  })
})

function lane(...attempts: Attempt[]): Track {
  return { deviceId: 'incubator-1', attempts }
}

function attempt(facts: Partial<Attempt>): Attempt {
  return {
    stepId: 'warm_reagent_plate',
    attempt: 1,
    deviceId: 'incubator-1',
    status: 'running',
    refused: false,
    startedAt: null,
    endedAt: null,
    error: null,
    ...facts,
  }
}
