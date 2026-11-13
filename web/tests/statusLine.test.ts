// The run's state as it reads outside the timeline: the blocked duration and
// the browser tab title.
import { describe, expect, test } from 'vitest'
import { formatDuration, isoDuration } from '../src/lib/duration'
import { pageTitle } from '../src/lib/pageTitle'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('a duration', () => {
  test('reads in the largest units that matter', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45 * SECOND)).toBe('45s')
    expect(formatDuration(4 * MINUTE + 2 * SECOND)).toBe('4m 02s')
    expect(formatDuration(HOUR + 5 * MINUTE + 59 * SECOND)).toBe('1h 05m')
  })

  test('rounds down to whole seconds', () => {
    expect(formatDuration(59_999)).toBe('59s')
  })

  test('reads as zero when clock skew makes it negative', () => {
    expect(formatDuration(-3 * SECOND)).toBe('0s')
    expect(isoDuration(-3 * SECOND)).toBe('PT0S')
  })

  test('has a machine-readable form', () => {
    expect(isoDuration(4 * MINUTE + 2 * SECOND)).toBe('PT242S')
  })
})

describe('the tab title', () => {
  test('starts with the run state', () => {
    expect(pageTitle('r-1', 'running', 'live')).toBe(
      'Running · r-1 · Lab run monitor',
    )
    expect(pageTitle('r-1', 'completed', 'live')).toBe(
      'Completed · r-1 · Lab run monitor',
    )
  })

  test('says blocked even when disconnected, because it needs someone', () => {
    expect(pageTitle('r-1', 'blocked', 'stale')).toBe(
      'Blocked · r-1 · Lab run monitor',
    )
  })

  test('says disconnected rather than show a state that may be out of date', () => {
    expect(pageTitle('r-1', 'running', 'stale')).toBe(
      'Disconnected · r-1 · Lab run monitor',
    )
  })

  test('leaves out a state it does not know', () => {
    expect(pageTitle('r-1', 'unknown', 'connecting')).toBe(
      'r-1 · Lab run monitor',
    )
  })
})
