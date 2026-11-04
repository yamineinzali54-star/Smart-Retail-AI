"""Central configuration. All model IDs / keys are env-driven because the
OpenRouter :free list changes frequently — never hard-code a model ID."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ai_service_token: str = ""
    ai_database_url: str = ""
    redis_url: str = "redis://localhost:6379/0"
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_zdr: bool = True
    openrouter_data_collection: str = "deny"
    ai_model_sql: str = "qwen/qwen3.8-27b:free"
    ai_model_narrate: str = "google/gemma-4-31b-it:free"
    ai_model_fallback: str = "openrouter/free"
    # Comma-separated branch codes the nightly beat schedule iterates.
    # Single-branch-first default; add codes (no code change) to scale out.
    nightly_branch_codes: str = "YGN"
    # Filesystem root for generated artifacts (dataset CSVs, model files).
    # The forecasting KDD pipeline is file-first: the database is read once
    # to produce dataset_raw.csv, every later step works on that file.
    ai_artifact_dir: str = "./artifacts/forecast"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
