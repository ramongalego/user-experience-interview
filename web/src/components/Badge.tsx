import type { ReactNode } from 'react'

const TONE: Record<string, string> = {
  dispatched: 'bg-waiting text-ink',
  running: 'bg-running-soft text-ink',
  done: 'bg-done-soft text-ink',
  failed: 'bg-failed-soft text-failed',
}

export function Badge({
  children,
  tone = 'dispatched',
}: {
  children: ReactNode
  tone?: string
}) {
  return (
    <span
      className={`rounded px-2 text-xs leading-5 font-medium ${TONE[tone] ?? TONE.dispatched}`}
    >
      {children}
    </span>
  )
}
