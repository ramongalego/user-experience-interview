# Notes

Time spent: 2 hours

AI assistance: I used Claude Code to reason through the problems, but I did most of the work myself.

On top of the provided checks, I added `tests/test_retry.py`, `tests/test_resume.py`,
`web/tests/runState.behaviour.test.ts`, `web/tests/timeWindow.test.ts`,
`web/tests/statusLine.test.ts` and `./scripts/check-failure.sh`, which runs
problem 2 end to end.

## Problem 2: the failure surface

- Each failure gets a card under the timeline. It shows the instrument's
  message, its code, and the `context` keys exactly as sent. It also says which
  later steps are waiting on it, worked out from the workflow's `depends_on`.
- Each card has one main action. If the fault is retryable, that's Retry. If
  it isn't, there's no retry button. The main action becomes Copy report: a
  plain-text summary to paste into a ticket for whoever looks after the
  instrument.
- The retry button only reports what the server said: queued, refused (with
  the reason), or no answer. On no answer it says trying again is safe, because
  the request names the attempt. The card only changes once the stream shows
  the new attempt.
- Once a failure has been retried, it collapses to a one-line summary and its
  bar goes from solid red to a light red outline. Only failures that still need
  someone stand out.
- Red bars link to their card, so you can go from the timeline to the details.
- While a run is blocked, the header shows how long it has been waiting. In a
  lab that time costs samples, so it should be visible.
- The tab title starts with the run's state, like "Blocked · r-1". The tab is
  usually in the background while someone is at the bench.

## Small changes to the provided UI

The README says the timeline is provided and that looks aren't scored, so I
kept this small. I only changed things that got in the way of the failure
surface:

- Colour only means state now. I replaced Tailwind's default colours with a
  small set (waiting, running, done, failed, disconnected), so an open failure
  is the strongest thing on the page.
- The timeline axis stops when nothing is running. Before, it kept stretching
  after a run had finished, so a finished run looked live. Tick labels are now
  whole seconds of the run instead of the wall clock.
- One shared `Button` instead of three hand-styled ones. I also added an empty
  state before the first run, a "Starting…" state so a double click can't
  create two runs, and an error when the simulator can't be reached.
- Bars, badges and axis labels have a bit more padding and a 12px minimum
  size. Focus rings are visible, so the bar links work from the keyboard.

## 1. What I deliberately did not build

- A reorder buffer. I made order not matter instead. Each event is a fact about
  one `(step, attempt)`, and merging only ever adds to what we know. Status only
  moves forward and timestamps are set once. I use `seq` to account for events,
  not to reorder them.
- A server heartbeat. Nothing comes after the last event in a burst, so if that
  event is lost there's no sign of it. Instead, when the stream goes quiet, the
  hook reads the snapshot, compares its `seq` with its own, and resumes if it's
  behind. That's one read per lull. The proper fix is for the stream to announce
  its own position, but that's a contract change.
- Rebuilding the screen from a snapshot after a gap. The snapshot only has each
  step's latest attempt, so applying it would throw away replayed events about
  older attempts. The screen stays partial and says so.
- An override for non-retryable faults, a record of who retried, or any
  per-instrument rendering of `context`. I don't know that vocabulary, so I show
  it as sent.
- A way to end or abandon a blocked run. The contract has no way out of
  `blocked`, so the screen can't offer one honestly.
- Browser notifications or sounds when a run blocks. They need permission
  prompts, and the tab title covers the "tab in the background" case.
- A "last heard from the lab" indicator. The hook already notices when the
  stream goes quiet, but choosing when that counts as a problem needs step
  durations the screen doesn't have.

## 2. Where the state layer is most likely to break

- It only works if every fact can be merged. An event that takes something back,
  like a corrected end time, wouldn't fit.
- Run status is inferred. Nothing tells me a blocked run has resumed, so I treat
  a dispatch as running. If two steps fail and only one is retried, the engine
  quietly stays blocked, but my header would say running.
- I treat an event as missing once 8 more have arrived after it, because a reducer
  has no clock. Near the end of a run, only the hook's quiet check will catch it.
- After a gap, an attempt whose end event was lost stays "running", even if a
  later start on the same device proves it finished. The timeline keeps drawing
  it up to now, even after the run says completed.
- Which steps a failure holds up comes from the snapshot's `depends_on`. Events
  never carry it, so until a snapshot arrives the card just doesn't say.
- The blocked timer counts from the failure, not from the moment the run went
  blocked. If other steps were still finishing, it reads a few seconds high.

## 3. An event for a step I have never seen

It gets a bar. The reducer doesn't keep a list of steps. It keys on the event's
own `step_id`, `attempt` and `device_id`. An unknown device gets its own track
after the three known ones. If the step fails, it gets a failure card like any
other, but the card won't say what's waiting on it, because the workflow doesn't
list it. An unknown event type is counted as received, so it doesn't look like
a loss, but otherwise it's ignored. An event for a different run is ignored and
not counted.

## 4. The contract, before an integrator builds on it

What I'd change:

- Add a heartbeat that carries the watermark.
- Make the snapshot include every attempt, plus `refused`. Right now, once a
  retry is claimed, the failure disappears from it.
- Add `run.started` and `run.resumed`. At the moment `blocked` has no way back,
  and the snapshot says `blocked` while a retry is running.
- Add a stream epoch, or make run ids unique. Ids restart at `r-1` when the
  server restarts, so a client can't tell the new `r-1` from the old one.
- Make `attempt` required on retry. It's only optional because the provided test
  posts no body. Also use one error envelope everywhere, the 422 included.

What I'd keep:

- A per-run monotonic `seq` with at-least-once delivery.
- `(step_id, attempt)` as identity.
- `error` as fixed fields plus an open `context`.
- `retryable` decided by the instrument.
- A retry answered with 202 and confirmed through the stream.

## The exercise

- Problem 1 was clear, but the tests are the real spec. The gap frame's shape
  (`type`, `from`, `earliest`) only appears in the vitest file, while the README
  says the shape is up to me.
- I had to guess whether `applySnapshot` should merge or replace, and how much I
  was allowed to change the provided files. `RunPage` never resets state between
  runs, so clicking "Start a run" again, or restarting the simulator (which
  reuses `r-1`), mixes two runs on one screen. I changed that.
- The README calls the timeline provided and styled, but a good failure surface
  needs the timeline and the cards to work together: linking bars to cards,
  quieting failures that were retried. I wasn't sure how far I could go, so I
  kept the visual changes small and listed them above.
- `RunPage` says "snapshot first, then subscribe from where the snapshot sits",
  but it starts both at the same time, so the first socket always resumes from 0.
- `REORDER_PCT` drops events, it doesn't just reorder them. The holding pen only
  flushes on the next reordered event, and it's shared across every socket. So a
  run can finish with an event that was never sent, and that event can turn up
  later on another run's socket. Before I handled this, 5 of 12 runs with
  `REORDER_PCT=30 DUPLICATE_PCT=20` ended on the wrong screen. After, 0 of 20.
  Telling this apart from my own bugs took the most time.
- `test_one_stalled_viewer_does_not_break_the_run` still passes if the healthy
  viewer gets disconnected too. The publisher never yields, so nobody can drain,
  and only a timeout would fail the test.
- Some references are out of date. `runState.ts` points to "TASK 2 in
  README.md", the vitest file calls itself "Gate 4", and Getting started says
  `cd ../web` from the root.
- The simulator image copies the source at build time, but the knob examples and
  check scripts restart it without `--build`. It's easy to end up testing stale
  code.
- `uv run pytest` takes about 70 seconds because the engine tests run in real
  time.
- Problem 2 was worth the time, especially the idempotency question.
