"""POST /jobs/enqueue — run a job synchronously (dev/simple path).
Provider request and spending limits apply to LLM-backed jobs. Production
pushes to a Redis Stream consumed by workers; the Next.js app relays results
over SSE (GET /api/ai/sse)."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.core.base_job import JobContext
from app.services.factory import build_llm_for_credentials, get_registry

router = APIRouter()


class EnqueueRequest(BaseModel):
    job_type: str
    branch_id: str
    params: dict = {}


@router.get("/jobs")
def list_jobs() -> dict:
    return {"ok": True, "job_types": get_registry().job_types()}


@router.post("/jobs/enqueue")
def enqueue(
    req: EnqueueRequest,
    ai_model_provider: str | None = Header(default=None, alias="x-ai-model-provider"),
    ai_model: str | None = Header(default=None, alias="x-ai-model"),
    ai_api_key: str | None = Header(default=None, alias="x-ai-api-key"),
    ai_max_tokens: int | None = Header(default=None, alias="x-ai-max-tokens"),
) -> dict:
    llm = None
    if req.job_type in {"rag_query", "rag_answer"}:
        if not ai_model or not ai_api_key:
            raise HTTPException(status_code=400, detail="AI_MODEL_REQUIRED")
        try:
            llm = build_llm_for_credentials(
                ai_model, ai_api_key, ai_max_tokens, ai_model_provider or "openrouter",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
    elif ai_model or ai_api_key:
        # Optional override for any narratable job (forecast_build, ops_alerts,
        # basket_build, price_optimize): the web app relays DB-stored model
        # credentials here so narration uses the selected model; without
        # headers the env/stub path still applies (rule-based narration when
        # offline).
        if not ai_model or not ai_api_key:
            raise HTTPException(status_code=400, detail="AI_MODEL_REQUIRED")
        try:
            llm = build_llm_for_credentials(
                ai_model, ai_api_key, ai_max_tokens, ai_model_provider or "openrouter",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
    try:
        job = get_registry().create(req.job_type, llm_override=llm)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    ctx = JobContext(branch_id=req.branch_id, params=req.params)
    result = job.execute(ctx)
    usage = getattr(llm, "usage", None)
    response = {"ok": result.ok, "job_id": result.job_id, "job": result.job_name,
                "data": result.data, "error": result.error}
    if isinstance(usage, dict):
        response["usage"] = usage
    return response
