/** A duration for a status line: "45s", "4m 02s", "1h 05m". Rounded down to
 *  whole seconds. Negative input, which clock skew between the lab and the
 *  browser can produce, reads as "0s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${twoDigits(minutes)}m`
  if (minutes > 0) return `${minutes}m ${twoDigits(seconds)}s`
  return `${seconds}s`
}

/** The same duration as an ISO 8601 value, for a `<time dateTime>`. */
export function isoDuration(ms: number): string {
  return `PT${Math.max(0, Math.floor(ms / 1000))}S`
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}
