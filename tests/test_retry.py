"""The retry endpoint's contract, as written at the top of simulator/retry.py."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from simulator.api import Config, create_app
from simulator.engine import DISPATCHED, DONE, FAILED, PENDING, RUNNING, Run
from simulator.workflow import fault_for

STEP = "warm_reagent_plate"
NOT_RETRYABLE_STEP = "read_plate"

Lab = tuple[httpx.AsyncClient, Run]


@pytest.fixture
async def lab() -> AsyncIterator[Lab]:
    app = create_app(Config())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://sim") as client:
        run_id = (await client.post("/runs")).json()["id"]
        yield client, app.state.server.runs[run_id]


def fail(run: Run, step_id: str = STEP, attempt: int = 1) -> None:
    step = run.steps[step_id]
    step.status, step.attempt = FAILED, attempt
    step.error = fault_for(step.device_id, step_id)


async def retry(client: httpx.AsyncClient, step_id: str = STEP, **body: int) -> httpx.Response:
    return await client.post(f"/runs/r-1/steps/{step_id}/retry", json=body or None)


async def test_a_retry_is_queued_as_the_next_attempt(lab: Lab) -> None:
    client, run = lab
    fail(run)

    res = await retry(client, attempt=1)

    assert res.status_code == 202
    assert res.json() == {"run_id": "r-1", "step_id": STEP, "attempt": 2}
    assert run.steps[STEP].status == PENDING


async def test_repeating_a_retry_starts_nothing_new(lab: Lab) -> None:
    client, run = lab
    fail(run)
    first = await retry(client, attempt=1)

    again = await retry(client, attempt=1)

    assert again.status_code == 200
    assert again.json() == first.json()
    assert run.steps[STEP].attempt == 1, "still waiting for its one dispatch"


async def test_a_stale_retry_cannot_put_a_third_attempt_on_the_instrument(lab: Lab) -> None:
    client, run = lab
    fail(run)
    await retry(client, attempt=1)
    fail(run, attempt=2)  # the retry ran, and failed as well

    late_duplicate = await retry(client, attempt=1)

    assert late_duplicate.status_code == 200
    assert late_duplicate.json()["attempt"] == 2
    assert run.steps[STEP].status == FAILED, "attempt 2's failure is still the operator's call"


async def test_without_an_attempt_the_current_failure_is_retried(lab: Lab) -> None:
    client, run = lab
    fail(run, attempt=2)

    res = await retry(client)

    assert res.status_code == 202
    assert res.json()["attempt"] == 3
    assert (await retry(client)).status_code == 200, "and it is already queued the second time"


async def test_a_fault_the_instrument_calls_not_retryable_is_refused(lab: Lab) -> None:
    client, run = lab
    fail(run, NOT_RETRYABLE_STEP)

    res = await retry(client, NOT_RETRYABLE_STEP, attempt=1)

    assert res.status_code == 409
    assert res.json()["code"] == "not_retryable"
    assert "CALIBRATION_EXPIRED" in res.json()["error"]
    assert run.steps[NOT_RETRYABLE_STEP].status == FAILED


@pytest.mark.parametrize(
    ("status", "attempt"), [(PENDING, 0), (DISPATCHED, 1), (RUNNING, 1), (DONE, 1)]
)
async def test_a_step_that_has_not_failed_is_left_alone(
    lab: Lab, status: str, attempt: int
) -> None:
    client, run = lab
    step = run.steps[STEP]
    step.status, step.attempt = status, attempt

    res = await retry(client)

    assert res.status_code == 409
    assert res.json()["code"] == "step_not_failed"
    assert (step.status, step.attempt) == (status, attempt)


async def test_what_does_not_exist_is_not_found(lab: Lab) -> None:
    client, run = lab
    fail(run)

    no_run = await client.post(f"/runs/r-9/steps/{STEP}/retry")
    no_step = await retry(client, "centrifuge")
    no_attempt = await retry(client, attempt=2)

    assert [r.status_code for r in (no_run, no_step, no_attempt)] == [404, 404, 404]
    assert [r.json()["code"] for r in (no_run, no_step, no_attempt)] == [
        "no_such_run",
        "no_such_step",
        "no_such_attempt",
    ]
    assert run.steps[STEP].status == FAILED
