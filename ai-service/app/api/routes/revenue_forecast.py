"""Training and serving endpoints for weekly revenue forecasting."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.features.forecasting.revenue import (
    get_revenue_forecast,
    train_revenue_model,
)
from app.services.factory import get_db

router = APIRouter()
logger = logging.getLogger(__name__)
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


def _event(name: str, payload: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get("/revenue-forecast")
def revenue_forecast(branch_id: str) -> dict:
    if not branch_id.strip():
        raise HTTPException(status_code=400, detail="branch_id is required")
    try:
        return {"ok": True, **get_revenue_forecast(get_db(), branch_id)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/revenue-forecast/train")
def train_revenue_forecast(branch_id: str) -> dict:
    if not branch_id.strip():
        raise HTTPException(status_code=400, detail="branch_id is required")
    try:
        result = train_revenue_model(get_db(), branch_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return {"ok": True, **result}


@router.get("/revenue-forecast/train/stream")
def train_revenue_forecast_stream(branch_id: str):
    if not branch_id.strip():
        raise HTTPException(status_code=400, detail="branch_id is required")

    db = get_db()

    async def stream():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        started: dict[str, float] = {}
        active_step: list[str | None] = [None]

        def progress(step: str, status: str, detail: dict) -> None:
            now = time.monotonic()
            if status == "running":
                started.setdefault(step, now)
                active_step[0] = step
            elapsed = round((now - started.pop(step, now)) * 1000) if status in {"ok", "error"} else 0
            if status in {"ok", "error"} and active_step[0] == step:
                active_step[0] = None
            payload = {
                "step": step,
                "status": status,
                "duration_ms": elapsed,
                "detail": detail,
            }
            loop.call_soon_threadsafe(queue.put_nowait, _event("status", payload))

        async def train() -> None:
            try:
                result = await asyncio.to_thread(train_revenue_model, db, branch_id, progress)
                await queue.put(_event("done", {"ok": True, **result}))
            except ValueError as exc:
                if active_step[0]:
                    progress(active_step[0], "error", {"message": str(exc)})
                await queue.put(_event("done", {"ok": False, "error": str(exc)}))
            except Exception as exc:
                logger.exception("Revenue model training failed for branch %s", branch_id)
                if active_step[0]:
                    progress(active_step[0], "error", {"message": "Training failed"})
                await queue.put(_event("done", {
                    "ok": False,
                    "error": "Revenue model training failed",
                    "error_type": type(exc).__name__,
                }))
            finally:
                await queue.put(None)

        task = asyncio.create_task(train())
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
        await task

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)

