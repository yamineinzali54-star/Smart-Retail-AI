"""Optional LLM narration over computed forecasts. Rule-based fallback so
the page never depends on AI availability."""

from __future__ import annotations

from typing import Any

from app.core.llm.base import BaseLLMProvider
from .prompts import FORECAST_SYSTEM_PROMPT


class ForecastNarrator:
    def __init__(self, llm: BaseLLMProvider | None = None):
        self._llm = llm

    def narrate(
        self, *, forecasts: list[dict[str, Any]], days: int, locale: str = "en"
    ) -> str:
        needy = [f for f in forecasts if f.get("needs_order")]
        fallback = self.fallback(forecasts, days)
        # getattr: callers may pass duck-typed fakes that aren't providers.
        # offline stub = missing API key → rule-based prose, never canned SQL.
        if self._llm is None or getattr(self._llm, "offline", False):
            return fallback
        language = "Myanmar" if locale == "my" else "English"
        top = [
            {"product": f["product_name"], "avg_per_day": f["avg_daily_sales"],
             "on_hand": f["on_hand"], "suggested_qty": f["suggested_qty"]}
            for f in needy[:5]
        ]
        try:
            text = self._llm.complete(
                f"History window: {days} days. Products needing order: {len(needy)}. "
                f"Top: {top}",
                system=FORECAST_SYSTEM_PROMPT.format(language=language),
            )
            return text.strip() or fallback
        except Exception:
            return fallback

    @staticmethod
    def fallback(forecasts: list[dict[str, Any]], days: int) -> str:
        needy = [f for f in forecasts if f.get("needs_order")]
        if not needy:
            return f"Stock looks healthy: no product needs reordering over the last {days} days of sales."
        names = ", ".join(f["product_name"] for f in needy[:3])
        more = f" (+{len(needy) - 3} more)" if len(needy) > 3 else ""
        return (
            f"{len(needy)} product(s) need reordering based on the last {days} days: "
            f"{names}{more}."
        )
