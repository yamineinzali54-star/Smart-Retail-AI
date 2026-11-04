"""Maps job-type strings (PROJECT_PLAN.md §7.17) to job classes.
LLM-backed jobs receive their provider via `configure_llm`."""

from __future__ import annotations

from app.core.base_job import BaseJob
from app.core.db import Database
from app.core.llm.base import BaseLLMProvider, StubLLMProvider
from app.features.alerts.job import OpsAlertsJob
from app.features.basket.analyzer import BasketJob
from app.features.basket.builder import BasketBuildJob
from app.features.forecasting.builder import ForecastBuildJob
from app.features.forecasting.forecaster import ForecastJob
from app.features.forecasting.train_job import ForecastTrainJob
from app.features.pricing.optimizer import PriceOptimizeJob
from app.features.rag.answer import RAGAnswerJob
from app.features.rag.sql_cache import get_sql_cache
from app.features.rag.text_to_sql import TextToSQLJob


class JobRegistry:
    _FACTORIES = {
        "ops_alerts": lambda llm, db: OpsAlertsJob(llm, db),
        "forecast": lambda llm, db: ForecastJob(),
        "forecast_build": lambda llm, db: ForecastBuildJob(llm, db),
        "forecast_train": lambda llm, db: ForecastTrainJob(db),
        "promotion_suggest": lambda llm, db: BasketJob(),
        "basket_build": lambda llm, db: BasketBuildJob(llm, db),
        "price_optimize": lambda llm, db: PriceOptimizeJob(llm),
        "rag_query": lambda llm, db: TextToSQLJob(llm, db, cache=get_sql_cache()),
        "rag_answer": lambda llm, db: RAGAnswerJob(llm, db, cache=get_sql_cache()),
    }

    def __init__(
        self,
        llm: BaseLLMProvider | None = None,
        db: Database | None = None,
        narrator_llm: BaseLLMProvider | None = None,
    ):
        self._llm = llm or StubLLMProvider()
        self._db = db
        self._narrator_llm = narrator_llm or self._llm

    def configure_llm(self, llm: BaseLLMProvider) -> None:
        self._llm = llm

    def job_types(self) -> list[str]:
        return sorted(self._FACTORIES)

    def create(
        self, job_type: str, *, llm_override: BaseLLMProvider | None = None,
    ) -> BaseJob:
        if job_type in {"rag_query", "rag_answer"} and llm_override is None:
            raise ValueError("AI_MODEL_REQUIRED")
        llm = llm_override or self._llm
        if job_type == "rag_answer":
            return RAGAnswerJob(
                llm, self._db, llm_override or self._narrator_llm,
                cache=get_sql_cache(),
            )
        try:
            factory = self._FACTORIES[job_type]
        except KeyError:
            raise KeyError(f"unknown job type: {job_type}") from None
        return factory(llm, self._db)
