"""The event stream for one run, with resume support.

Every event gets a monotonic ``seq`` and is kept in a bounded replay buffer. A
subscriber passes the last ``seq`` it has, receives the events it missed, and
then receives new events live. If the events it missed have already been
evicted from the buffer, the subscription is marked as a gap.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from simulator.events import Event

#: How many events a subscriber may fall behind before it is disconnected.
SUBSCRIBER_QUEUE_SIZE = 256


@dataclass
class Subscription:
    """What ``Stream.subscribe`` hands back.

    ``backlog`` is written to the socket before ``queue`` is drained.
    ``gap`` reports that the requested position can no longer be served.
    A ``None`` on ``queue`` means the subscriber fell too far behind and was
    disconnected; it can resume from the last ``seq`` it received.
    """

    backlog: list[Event]
    queue: asyncio.Queue[Event | None]
    gap: bool
    cancel: Callable[[], None]


class Stream:
    def __init__(self, buf_size: int) -> None:
        self._buffer: deque[Event] = deque(maxlen=buf_size)
        self._seq = 0
        self._lock = asyncio.Lock()
        self._subs: set[asyncio.Queue[Event | None]] = set()

    async def publish(self, event: Event) -> None:
        """Number an event, record it for replay, and deliver it without blocking."""
        async with self._lock:
            self._seq += 1
            event.seq = self._seq
            self._buffer.append(event)
            for queue in tuple(self._subs):
                if queue.qsize() < SUBSCRIBER_QUEUE_SIZE:
                    queue.put_nowait(event)
                else:
                    self._disconnect(queue)

    async def subscribe(self, resume_from: int) -> Subscription:
        """Replay everything after ``resume_from``, then go live.

        Backlog and registration share one critical section with ``publish``,
        so no event can fall between the two or arrive in both.
        """
        # Unbounded so the None that ends a slow subscriber always fits; publish
        # enforces the limit.
        queue: asyncio.Queue[Event | None] = asyncio.Queue()
        async with self._lock:
            last_evicted = self._seq - len(self._buffer)
            # Servable if every event after resume_from is still buffered and
            # resume_from is not ahead of the stream.
            servable = last_evicted <= resume_from <= self._seq
            backlog = [event for event in self._buffer if event.seq > resume_from]
            self._subs.add(queue)
        return Subscription(
            backlog, queue, gap=not servable, cancel=lambda: self._subs.discard(queue)
        )

    async def watermark(self) -> int:
        """The sequence number of the most recent published event."""
        return self._seq

    async def earliest(self) -> int:
        """The oldest sequence number still replayable, or 0 when nothing is held."""
        return self._buffer[0].seq if self._buffer else 0

    def _disconnect(self, queue: asyncio.Queue[Event | None]) -> None:
        self._subs.discard(queue)
        queue.put_nowait(None)
