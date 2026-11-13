// The time range the timeline covers, and whether it is still growing.
import type { Track } from './runState'

export interface TimeWindow {
  /** When the first attempt started. Null until one has. */
  start: number | null
  /** The latest moment an instrument reported. Null until one has. */
  lastReport: number | null
  /** True while any attempt has no reported end (dispatched or running). The
   *  timeline then extends to the current time; otherwise it ends at
   *  `lastReport`. */
  ongoing: boolean
}

export function timeWindowOf(tracks: Track[]): TimeWindow {
  const attempts = tracks.flatMap((track) => track.attempts)
  const starts = attempts.flatMap((a) => known(a.startedAt))
  const reports = attempts.flatMap((a) => [
    ...known(a.startedAt),
    ...known(a.endedAt),
  ])
  return {
    start: starts.length > 0 ? Math.min(...starts) : null,
    lastReport: reports.length > 0 ? Math.max(...reports) : null,
    ongoing: attempts.some((a) => a.endedAt === null),
  }
}

function known(time: number | null): number[] {
  return time === null ? [] : [time]
}
