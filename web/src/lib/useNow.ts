import { useEffect, useState } from 'react'

/** The current time, updated every `intervalMs` while `ticking` is true. While
 *  paused it keeps its last value and causes no re-renders. */
export function useNow(ticking: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [ticking, intervalMs])

  return now
}
