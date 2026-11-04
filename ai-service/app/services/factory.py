"""Wiring: builds the LLM (OpenRouter chain or offline stub), the read-only
Database and the registry from Settings. Singletons live
here so the API routes and the SSE stream share them."""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.core.db import Database
from app.core.llm.base import BaseLLMProvider, StubLLMProvider
from app.core.llm.fallback import FallbackLLMProvider
from app.core.llm.openrouter import OpenRouterProvider
from app.services.job_registry import JobRegistry

# Shown when no API key is configured. Contains branch_id so it passes the
# SQL guard and executes harmlessly.
OFFLINE_SQL = (
    "SELECT 'AI service has no OPENROUTER_API_KEY configured' AS notice "
    "WHERE 'branch_id' = 'branch_id'"
)


def _build_llm_for_model(model: str) -> BaseLLMProvider:
    primary = OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=model,
        base_url=settings.openrouter_base_url,
        zdr=settings.openrouter_zdr,
        data_collection=settings.openrouter_data_collection,
    )
    fallback = OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=settings.ai_model_fallback,
        base_url=settings.openrouter_base_url,
        zdr=settings.openrouter_zdr,
        data_collection=settings.openrouter_data_collection,
    )
    return FallbackLLMProvider([primary, fallback])


def build_llm_for_credentials(
    model: str, api_key: str, max_tokens: int | None = None, provider: str = "openrouter",
) -> BaseLLMProvider:
    """Build a chat provider from credentials supplied by the trusted web app."""
    if provider == "opencode_zen":
        return OpenRouterProvider(
            api_key=api_key,
            model=model,
            # Zen uses its own API keys and endpoint. Keep this separate from
            # Console service-account inference at /inference/openai/v1.
            base_url="https://opencode.ai/zen/v1",
            max_tokens=max_tokens,
            include_openrouter_options=False,
        )
    if provider == "opencode_console":
        return OpenRouterProvider(
            api_key=api_key,
            model=model,
            base_url="https://opencode.ai/inference/openai/v1",
            max_tokens=max_tokens,
            include_openrouter_options=False,
        )
    if provider != "openrouter":
        raise ValueError("Unsupported AI model provider")
    return OpenRouterProvider(
        api_key=api_key,
        model=model,
        base_url=settings.openrouter_base_url,
        zdr=settings.openrouter_zdr,
        data_collection=settings.openrouter_data_collection,
        max_tokens=max_tokens,
    )


def build_llm() -> BaseLLMProvider:
    if settings.openrouter_api_key:
        return _build_llm_for_model(settings.ai_model_sql)
    # offline=True: the canned SQL still exercises the text-to-SQL path, but
    # narrators skip it and use rule-based fallbacks (no SQL leaked as prose).
    return StubLLMProvider(OFFLINE_SQL, offline=True)


def build_narrator_llm() -> BaseLLMProvider:
    if settings.openrouter_api_key:
        return _build_llm_for_model(settings.ai_model_narrate)
    return StubLLMProvider(OFFLINE_SQL, offline=True)


@lru_cache(maxsize=1)
def get_services() -> tuple[BaseLLMProvider, Database, JobRegistry, BaseLLMProvider]:
    llm = build_llm()
    narrator_llm = build_narrator_llm()
    if not settings.ai_database_url:
        raise RuntimeError("AI_DATABASE_URL is required (use the dedicated read-only role)")
    db = Database(settings.ai_database_url)
    registry = JobRegistry(llm, db, narrator_llm)
    return llm, db, registry, narrator_llm


def get_llm() -> BaseLLMProvider:
    return get_services()[0]


def get_db() -> Database:
    return get_services()[1]


def get_registry() -> JobRegistry:
    return get_services()[2]


def get_narrator_llm() -> BaseLLMProvider:
    return get_services()[3]
