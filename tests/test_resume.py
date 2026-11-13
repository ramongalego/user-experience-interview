"""What a client is told over the socket when it comes back."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from simulator.api import Config, create_app
from simulator.events import STEP_STARTED, Event
from simulator.stream import SUBSCRIBER_QUEUE_SIZE, Stream

BUFFER = 4
PUBLISHED = 10


def lab(client: TestClient, app: FastAPI, events: int) -> tuple[str, Stream]:
    """A run whose stream has already published ``events`` events."""
    run_id: str = client.post("/runs").json()["id"]
    stream: Stream = app.state.server.streams[run_id]
    publish(client, stream, run_id, events)
    return run_id, stream


def publish(client: TestClient, stream: Stream, run_id: str, events: int) -> None:
    async def burst() -> None:
        for _ in range(events):
            await stream.publish(Event(run_id=run_id, type=STEP_STARTED, at="2026-09-02T00:00:00Z"))

    assert client.portal is not None
    client.portal.call(burst)


def test_an_unservable_resume_is_announced_before_any_replay() -> None:
    app = create_app(Config(replay_buffer_size=BUFFER))
    with TestClient(app) as client:
        run_id, _ = lab(client, app, PUBLISHED)

        with client.websocket_connect(f"/ws?run_id={run_id}&resume_from=2") as ws:
            assert ws.receive_json() == {"type": "gap", "from": 2, "earliest": 7}
            assert [ws.receive_json()["seq"] for _ in range(BUFFER)] == [7, 8, 9, 10]


def test_with_nothing_left_to_replay_the_gap_runs_to_the_next_event() -> None:
    app = create_app(Config(replay_buffer_size=0))
    with TestClient(app) as client:
        run_id, _ = lab(client, app, PUBLISHED)

        with client.websocket_connect(f"/ws?run_id={run_id}&resume_from=2") as ws:
            assert ws.receive_json() == {"type": "gap", "from": 2, "earliest": PUBLISHED + 1}


def test_a_clean_resume_replays_only_what_was_missed() -> None:
    app = create_app(Config(replay_buffer_size=BUFFER))
    with TestClient(app) as client:
        run_id, _ = lab(client, app, PUBLISHED)

        with client.websocket_connect(f"/ws?run_id={run_id}&resume_from=8") as ws:
            assert [ws.receive_json()["seq"] for _ in range(2)] == [9, 10]


def test_a_position_the_stream_never_reached_is_a_gap() -> None:
    """A client ahead of the stream has positions from a different stream, for
    example from before the server restarted."""
    app = create_app(Config(replay_buffer_size=BUFFER))
    with TestClient(app) as client:
        run_id, _ = lab(client, app, PUBLISHED)

        with client.websocket_connect(f"/ws?run_id={run_id}&resume_from=99") as ws:
            assert ws.receive_json()["type"] == "gap"


def test_a_viewer_that_falls_behind_is_disconnected_and_can_resume() -> None:
    app = create_app(Config())
    with TestClient(app) as client:
        run_id, stream = lab(client, app, 0)

        with client.websocket_connect(f"/ws?run_id={run_id}&resume_from=0") as ws:
            publish(client, stream, run_id, SUBSCRIBER_QUEUE_SIZE + 10)
            received = [ws.receive_json()["seq"] for _ in range(SUBSCRIBER_QUEUE_SIZE)]
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()

        assert received == list(range(1, SUBSCRIBER_QUEUE_SIZE + 1)), "no hole before the cut"
        with client.websocket_connect(f"/ws?run_id={run_id}&resume_from={received[-1]}") as ws:
            assert ws.receive_json()["seq"] == SUBSCRIBER_QUEUE_SIZE + 1
