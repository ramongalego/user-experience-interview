// Provided. Plain fetch against the simulator.
import type { Snapshot } from './types'

const BASE = import.meta.env.VITE_SIM_URL ?? 'http://localhost:5002'

export async function createRun(): Promise<string> {
  const r = await fetch(`${BASE}/runs`, { method: 'POST' })
  return (await r.json()).id as string
}

export async function startRun(id: string): Promise<void> {
  await fetch(`${BASE}/runs/${id}/start`, { method: 'POST' })
}

export async function listRuns(): Promise<{ id: string; status: string }[]> {
  const r = await fetch(`${BASE}/runs`)
  return (await r.json()).runs
}

export async function fetchSnapshot(id: string): Promise<Snapshot> {
  const r = await fetch(`${BASE}/runs/${id}`)
  return (await r.json()) as Snapshot
}

/** The three things a retry request can come back as. See simulator/retry.py. */
export type RetryOutcome =
  /** Queued, now or by an earlier call. It will run as `attempt`. */
  | { kind: 'accepted'; attempt: number }
  | { kind: 'refused'; reason: string }
  /** No answer. The lab may or may not have received it. */
  | { kind: 'unconfirmed' }

/** Naming the failed attempt makes this safe to send twice. */
export async function retryStep(
  runId: string,
  stepId: string,
  failedAttempt: number,
): Promise<RetryOutcome> {
  try {
    const r = await fetch(`${BASE}/runs/${runId}/steps/${stepId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt: failedAttempt }),
    })
    const body = await r.json()
    return r.ok
      ? { kind: 'accepted', attempt: body.attempt as number }
      : { kind: 'refused', reason: (body.error ?? r.statusText) as string }
  } catch {
    return { kind: 'unconfirmed' }
  }
}

export function wsURL(runId: string, resumeFrom: number): string {
  const base = BASE.replace(/^http/, 'ws')
  return `${base}/ws?run_id=${encodeURIComponent(runId)}&resume_from=${resumeFrom}`
}
