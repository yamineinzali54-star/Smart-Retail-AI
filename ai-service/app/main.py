"""FastAPI entry point. Run: uvicorn app.main:app --reload --port 8000"""

import hmac

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.routes import chat_forecast, forecast, health, jobs, revenue_forecast, stream
from app.config import settings

app = FastAPI(title="SmartRetailAI — AI Service")


@app.middleware("http")
async def require_pos_service_token(request: Request, call_next):
    # Keep liveness checks available to the platform; all functional AI and
    # discovery endpoints require a token held only by the POS server.
    if request.url.path == "/health":
        return await call_next(request)

    expected = settings.ai_service_token
    supplied = request.headers.get("x-ai-service-token", "")
    if not expected:
        return JSONResponse(
            {"ok": False, "error": "AI_SERVICE_TOKEN_NOT_CONFIGURED"},
            status_code=503,
        )
    if not supplied or not hmac.compare_digest(supplied, expected):
        return JSONResponse({"ok": False, "error": "UNAUTHORIZED"}, status_code=401)
    return await call_next(request)


app.include_router(health.router)
app.include_router(jobs.router)
app.include_router(stream.router)
app.include_router(chat_forecast.router)
app.include_router(forecast.router)
app.include_router(revenue_forecast.router)
