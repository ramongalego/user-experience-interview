// Wires the snapshot and the socket into the state of one run.
import { useEffect, useRef, useState } from 'react'
import { fetchSnapshot } from './api'
import { connect } from './socket'
import {
  applyMessage,
  applySnapshot,
  applyTransport,
  createRunState,
  selectResumeFrom,
} from './runState'
import type { RunState } from './runState'

/** How long the stream can stay quiet before we compare our position with
 *  the server's. */
const QUIET_MS = 1000

export function useRunState(runId: string): RunState {
  const [state, setState] = useState(() => createRunState(runId))
  const [connection, setConnection] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let alive = true
    void fetchSnapshot(runId).then((snap) => {
      if (alive) setState((s) => applySnapshot(s, snap))
    })
    return () => {
      alive = false
    }
  }, [runId])

  useEffect(() => {
    let alive = true
    // A socket that has been torn down still fires onClose, so updates after
    // cleanup are dropped.
    const fold = (step: (s: RunState) => RunState) => {
      if (alive) setState(step)
    }
    const close = connect(runId, {
      resumeFrom: () => selectResumeFrom(stateRef.current),
      onMessage: (msg) => fold((s) => applyMessage(s, msg)),
      onOpen: () => fold((s) => applyTransport(s, 'open')),
      onClose: () => fold((s) => applyTransport(s, 'closed')),
    })
    return () => {
      alive = false
      close()
    }
  }, [runId, connection])

  // If the last event in a burst is lost, no later event arrives to reveal the
  // gap. So when the stream goes quiet, fetch the snapshot once and compare its
  // seq with ours. If we are behind, reconnect: the server replays what we
  // missed, or sends a gap frame if it no longer has it.
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      const resumeIfBehind = (snap: { seq: number }) => {
        if (alive && snap.seq > selectResumeFrom(state))
          setConnection((n) => n + 1)
      }
      // If the server is unreachable, the socket is already retrying and will
      // resume on its own.
      fetchSnapshot(runId).then(resumeIfBehind, () => undefined)
    }, QUIET_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [runId, state])

  return state
}
