"""Retrying a failed step.

    POST /runs/{run_id}/steps/{step_id}/retry
    {"attempt": 1}        optional: the failed attempt being retried

    202  {"run_id", "step_id", "attempt"}   queued; it will run as ``attempt``
    200  {"run_id", "step_id", "attempt"}   that failure was already retried;
                                            this call started nothing
    404  no_such_run, no_such_step, no_such_attempt
    409  step_not_failed, not_retryable

Every refusal is ``{"code": <one of the above>, "error": <a sentence>}``. A
malformed body is the exception: that is FastAPI's own 422.

Naming the attempt makes the call idempotent: sending it twice, or again after
a timeout, never queues a second retry. Without it the call retries whichever
attempt is current, which is only safe if the caller has just read the step's
state.

A 202 means the retry is queued, not that it has run. It is confirmed by the
``step.dispatched`` event for the same step with the ``attempt`` returned here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from simulator.engine import FAILED, PENDING

if TYPE_CHECKING:
    from simulator.engine import Run, Step


class RetryRequest(BaseModel):
    attempt: int | None = Field(default=None, ge=1)


async def claim_retry(run: Run, step_id: str, attempt: int | None = None) -> tuple[int, bool]:
    """Moves a failed step back to pending so the engine dispatches it again, and
    reports what the next attempt will be.

    The decision and the state change are one critical section on purpose: two
    callers racing for the same failed step would otherwise both find it failed,
    and one failure would become two attempts. The transition itself is the
    claim -- the first caller moves the step out of failed and everyone else
    fails their own guard.

    Every condition for a retry is checked here for the same reason: a guard
    outside the lock is a guard on a value that may have changed.
    """
    async with run.lock:
        step = run.steps.get(step_id)
        if step is None or step.status != FAILED:
            return 0, False
        if attempt is not None and attempt != step.attempt:
            return 0, False
        if step.error is not None and not step.error.retryable:
            return 0, False
        step.status = PENDING
        step.refused = False
        step.started_at, step.ended_at, step.error = None, None, None
        # The engine increments attempt when it dispatches, so report the next
        # one rather than incrementing here.
        return step.attempt + 1, True


async def handle_retry(run: Run, step_id: str, attempt: int | None = None) -> Response:
    next_attempt, claimed = await claim_retry(run, step_id, attempt)
    if claimed:
        return _retried(run, step_id, next_attempt, status_code=202)
    # There is no await between the claim and here, so _explain sees the same
    # state the claim rejected.
    return _explain(run, step_id, run.steps.get(step_id), attempt)


def _explain(run: Run, step_id: str, step: Step | None, attempt: int | None) -> Response:
    if step is None:
        return _refused(404, "no_such_step", f"run {run.id} has no step {step_id}")
    failed_attempt = step.attempt if attempt is None else attempt
    if failed_attempt > step.attempt:
        return _refused(
            404, "no_such_attempt", f"{step_id} has not reached attempt {failed_attempt}"
        )
    retry_is_queued = step.status == PENDING and step.attempt > 0
    if failed_attempt < step.attempt or retry_is_queued:
        return _retried(run, step_id, failed_attempt + 1, status_code=200)
    if step.status != FAILED:
        return _refused(
            409,
            "step_not_failed",
            f"{step_id} is {step.status}; only a failed step can be retried",
        )
    fault = step.error
    assert fault is not None, "a failed step with no fault would have been claimed"
    return _refused(
        409,
        "not_retryable",
        f"{fault.instrument} reported {fault.code}, which a retry will not fix: {fault.detail}",
    )


def _retried(run: Run, step_id: str, attempt: int, *, status_code: int) -> Response:
    return JSONResponse(
        {"run_id": run.id, "step_id": step_id, "attempt": attempt}, status_code=status_code
    )


def _refused(status_code: int, code: str, error: str) -> Response:
    return JSONResponse({"code": code, "error": error}, status_code=status_code)
