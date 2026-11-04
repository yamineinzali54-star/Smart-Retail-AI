"""GET /health — liveness probe (Phase 8 exit criteria)."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "service": "smartretail-ai"}
