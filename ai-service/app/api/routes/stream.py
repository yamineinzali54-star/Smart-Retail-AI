"""GET /stream/rag — run the RAG pipeline with stepwise SSE events so the
Next.js relay (GET /api/ai/sse) can stream progress to the browser.

Events: status(checking_intent) -> either status(request_rejected) -> answer,
or schema/SQL generation -> validation -> execution -> narration. SQL and
database failures are diagnosed by the model and returned as answer events.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from app.core.base_job import JobContext
from app.core.sse import done_event, format_event
from app.config import settings
from app.features.rag.answer import MAX_ROWS, Narrator
from app.features.rag.sql_cache import get_sql_cache
from app.features.rag.text_to_sql import TextToSQLJob
from app.services.factory import (
    build_llm_for_credentials,
    get_db,
)

router = APIRouter()


@router.get("/stream/forecast_train")
def stream_forecast_train(
    branch_code: str = "",
    branch_id: str = "",
    collect: bool = True,
) -> StreamingResponse:
    """Run the forecasting KDD pipeline and stream each step as it happens.

    Events: status(step_name) per pipeline step, then a final done event
    with the model + metrics. Relayed by the web app so the dashboard can
    show the training progress live.

    branch_id takes precedence over branch_code so the model is trained
    for the exact branch the admin is logged into (the serving job then
    matches the session branch).
    """
    import asyncio

    from app.core.sse import done_event, format_event
    from app.features.forecasting.train_job import ForecastTrainJob
    from app.services.factory import get_db

    db = get_db()
    resolved_branch_id = branch_id.strip()
    code = branch_code.strip()
    if resolved_branch_id:
        rows = db.fetch_all("SELECT code FROM branch WHERE id = %s", (resolved_branch_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="branch not found")
        code = str(rows[0]["code"])
    else:
        code = code or settings.nightly_branch_codes.split(",")[0].strip()
        rows = db.fetch_all("SELECT id FROM branch WHERE code = %s", (code,))
        if not rows:
            raise HTTPException(status_code=404, detail="branch not found")
        resolved_branch_id = str(rows[0]["id"])

    async def gen():  # type: ignore[no-untyped-def]
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict] = asyncio.Queue()

        def on_step(step: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, step)

        yield format_event("collecting_dataset", event="status")
        job = ForecastTrainJob(db, on_step=on_step)
        task = asyncio.create_task(asyncio.to_thread(
            job.execute, JobContext(
                branch_id=resolved_branch_id,
                params={"branch_code": code, "collect": collect, "activate": True},
            )
        ))
        while not task.done():
            try:
                step = await asyncio.wait_for(queue.get(), timeout=15)
                yield format_event(json.dumps(step, default=str), event="status")
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
        while not queue.empty():
            step = queue.get_nowait()
            yield format_event(json.dumps(step, default=str), event="status")
        try:
            result = task.result()
        except Exception as exc:
            yield done_event({"ok": False, "error": str(exc)})
            return
        if not result.ok:
            yield done_event({"ok": False, "error": result.error or "training failed"})
            return
        data = result.data
        yield done_event({
            "ok": True,
            "job_id": result.job_id,
            "data": {
                "run_id": data.get("run_id"),
                "run_dir": data.get("run_dir"),
                "branch_code": data.get("branch_code"),
                "model": data.get("model"),
                "metrics": data.get("metrics"),
                "steps": data.get("steps"),
                "prepared": data.get("prepared"),
            },
        })

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/stream/rag")
def stream_rag(
    question: str,
    branch_id: str,
    history: str = "",
    ai_model_provider: str | None = Header(default=None, alias="x-ai-model-provider"),
    ai_model: str | None = Header(default=None, alias="x-ai-model"),
    ai_api_key: str | None = Header(default=None, alias="x-ai-api-key"),
    ai_max_tokens: int | None = Header(default=None, alias="x-ai-max-tokens"),
) -> StreamingResponse:
    if not question.strip() or len(question) > 500:
        raise HTTPException(status_code=400, detail="invalid question")
    if len(history) > 12_000:
        raise HTTPException(status_code=400, detail="conversation context is too large")
    try:
        parsed_history = json.loads(history) if history else []
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid conversation context") from None
    safe_history = TextToSQLJob._conversation_history(parsed_history)
    if not ai_model or not ai_api_key:
        raise HTTPException(status_code=400, detail="AI_MODEL_REQUIRED")
    try:
        llm = build_llm_for_credentials(ai_model, ai_api_key, ai_max_tokens, ai_model_provider or "openrouter")
    except ValueError:
        raise HTTPException(status_code=400, detail="unsupported model provider") from None
    narrator_llm = llm
    db = get_db()
    ctx = JobContext(branch_id=branch_id, params={"question": question, "history": safe_history})

    def usage_payload() -> dict:
        usage = getattr(llm, "usage", None)
        return {"usage": usage} if isinstance(usage, dict) else {}

    async def gen():  # type: ignore[no-untyped-def]
        yield format_event("checking_intent", event="status")
        loop = asyncio.get_running_loop()
        progress_queue: asyncio.Queue[str] = asyncio.Queue()

        def report_progress(phase: str) -> None:
            loop.call_soon_threadsafe(progress_queue.put_nowait, phase)

        sql_job = TextToSQLJob(llm, db, on_progress=report_progress, cache=get_sql_cache())
        diagnosis_result: list[str] = []

        async def diagnose_failure(stage: str, reason: str, sql: str | None):
            yield format_event("diagnosing_failure", event="status")
            diagnosis_task = asyncio.create_task(asyncio.to_thread(
                sql_job.explain_failure,
                question=question,
                stage=stage,
                reason=reason,
                sql=sql,
            ))
            while not diagnosis_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(diagnosis_task), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                except Exception:
                    break
            try:
                summary = diagnosis_task.result()
            except Exception:
                summary = (
                    "ဒီမေးခွန်းအတွက် read-only query ကို မပြီးမြောက်နိုင်ခဲ့ပါ။"
                    if any("\u1000" <= char <= "\u109f" for char in question)
                    else "The read-only query could not be completed."
                )
            diagnosis_result.append(summary)
            yield format_event("diagnosis_complete", event="status")
            yield format_event(json.dumps({"findings": [], "summary": summary}, ensure_ascii=False), event="answer")

        sql_task = asyncio.create_task(asyncio.to_thread(sql_job.execute, ctx))
        while not sql_task.done():
            try:
                phase = await asyncio.wait_for(progress_queue.get(), timeout=15)
                yield format_event(phase, event="status")
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
        while not progress_queue.empty():
            yield format_event(progress_queue.get_nowait(), event="status")
        try:
            sql_result = sql_task.result()
        except Exception as exc:
            async for event in diagnose_failure("SQL generation", str(exc), None):
                yield event
            summary = diagnosis_result[-1]
            yield done_event({"ok": True, **usage_payload(), "data": {
                "answer": summary, "summary": summary, "failure": True,
            }})
            return
        if not sql_result.ok:
            failure = sql_result.data or {}
            stage = str(failure.get("failure_stage") or "schema or SQL generation")
            sql_candidate = failure.get("sql_candidate")
            sql = sql_candidate if isinstance(sql_candidate, str) else None
            async for event in diagnose_failure(stage, sql_result.error or "unknown failure", sql):
                yield event
            summary = diagnosis_result[-1]
            yield done_event({"ok": True, **usage_payload(), "data": {
                "answer": summary, "summary": summary, "sql": sql, "failure": True,
            }})
            return
        generated = sql_result.data
        if generated.get("refused") is True:
            answer = str(generated.get("answer") or generated.get("summary") or "This chat is read-only.")
            yield format_event("request_rejected", event="status")
            yield format_event(json.dumps({"findings": [], "summary": answer}, ensure_ascii=False), event="answer")
            yield done_event({"ok": True, **usage_payload(), "data": generated})
            return
        yield format_event(generated.get("understanding", question), event="understanding")
        yield format_event(json.dumps(generated.get("plan", [])), event="plan")
        sql = generated["sql"]
        yield format_event(sql, event="sql")
        yield format_event("executing", event="status")
        rows_task = asyncio.create_task(asyncio.to_thread(db.fetch_all, sql))
        while not rows_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(rows_task), timeout=15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
            except Exception:
                break
        try:
            rows = rows_task.result()
        except Exception as exc:
            sql_job.invalidate_cached()
            async for event in diagnose_failure("database query", str(exc), sql):
                yield event
            summary = diagnosis_result[-1]
            yield done_event({"ok": True, **usage_payload(), "data": {
                "answer": summary, "summary": summary, "sql": sql, "failure": True,
            }})
            return
        yield format_event("query_complete", event="status")
        truncated = len(rows) > MAX_ROWS
        rows = rows[:MAX_ROWS]
        yield format_event(json.dumps(rows, default=str), event="rows")
        yield format_event("narrating", event="status")
        narration_task = asyncio.create_task(
            asyncio.to_thread(
                Narrator(narrator_llm).narrate_structured,
                question=question,
                sql=sql,
                rows=rows,
                history=safe_history,
            )
        )
        while not narration_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(narration_task), timeout=15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
            except Exception:
                break
        try:
            narration = narration_task.result()
        except Exception:
            narration = {"findings": [], "summary": Narrator.fallback(rows)}
        yield format_event("summary_complete", event="status")
        yield format_event(json.dumps(narration, ensure_ascii=False), event="answer")
        suggestions = generated.get("suggestions", [])
        yield format_event(json.dumps(suggestions, ensure_ascii=False), event="suggestions")
        yield done_event({"ok": True, "job_id": ctx.job_id, **usage_payload(), "data": {
            "question": question,
            "understanding": generated.get("understanding", question),
            "plan": generated.get("plan", []),
            "sql": sql,
            "sql_source": generated.get("sql_source", "model"),
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "findings": narration["findings"],
            "summary": narration["summary"],
            "answer": narration["summary"],
            "suggestions": suggestions}})

    return StreamingResponse(gen(), media_type="text/event-stream")
