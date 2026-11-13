// Maps run-relative milliseconds onto pixels.
import { scaleLinear } from 'd3-scale'

/** Minimum axis span, so the first second of a run is not stretched across
 *  the full width. */
const MIN_SPAN_MS = 1000

export function timeScale(t0: number, t1: number, width: number) {
  return scaleLinear()
    .domain([t0, t0 + spanOf(t0, t1)])
    .range([0, width])
    .clamp(true)
}

/** Tick positions as offsets from t0, so they land on round seconds of the run
 *  rather than of the wall clock. */
export function ticks(t0: number, t1: number, count = 6): number[] {
  return scaleLinear()
    .domain([0, spanOf(t0, t1)])
    .ticks(count)
}

function spanOf(t0: number, t1: number): number {
  return Math.max(t1 - t0, MIN_SPAN_MS)
}
