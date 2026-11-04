"""SSE helpers for streaming job results to the browser
(relayed by GET /api/ai/sse on the Next.js side)."""

from __future__ import annotations

from typing import Any


def format_event(data: str, *, event: str = "message") -> str:
    lines = data.splitlines() or [""]
    body = "".join(f"data: {line}\n" for line in lines)
    return f"event: {event}\n{body}\n"


def done_event(payload: dict[str, Any]) -> str:
    import json

    return format_event(json.dumps(payload, default=str), event="done")
