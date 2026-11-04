"""Optional LLM narration over thin-margin analysis. Rule-based fallback so
the margin page never depends on AI availability."""

from __future__ import annotations

from typing import Any

from app.core.llm.base import BaseLLMProvider

PRICING_SYSTEM_PROMPT = """You summarize thin-margin product analysis for a small shop owner.
Rules:
- 2-3 short sentences with the key numbers. Money is in kyat (K). Margins are percentages.
- Name the lowest-margin products first. Never advise automatic repricing — the owner sets prices.
- Never invent numbers not present in the input. If no products are below the floor, say margins look healthy.
- Answer in {language}.
"""


class PricingNarrator:
    def __init__(self, llm: BaseLLMProvider | None = None):
        self._llm = llm

    def narrate(
        self,
        *,
        flags: list[dict[str, Any]],
        min_margin_pct: float,
        locale: str = "en",
    ) -> str:
        fallback = self.fallback(flags, min_margin_pct)
        if self._llm is None or getattr(self._llm, "offline", False):
            return fallback
        language = "Myanmar" if locale == "my" else "English"
        top = [
            f"{f.get('product_name') or f.get('product_id')} "
            f"(margin {f.get('margin_pct')}%, cost K {f.get('cost')}, price K {f.get('price')})"
            for f in flags[:5]
        ]
        try:
            text = self._llm.complete(
                f"Products below the {min_margin_pct}% margin floor: {len(flags)}. "
                f"Top: {top}",
                system=PRICING_SYSTEM_PROMPT.format(language=language),
            )
            return text.strip() or fallback
        except Exception:
            return fallback

    @staticmethod
    def fallback(flags: list[dict[str, Any]], min_margin_pct: float) -> str:
        if not flags:
            return f"All products clear the {min_margin_pct:g}% margin floor."
        names = ", ".join(
            f"{f.get('product_name') or f.get('product_id')} ({f.get('margin_pct')}%)"
            for f in flags[:3]
        )
        more = f" (+{len(flags) - 3} more)" if len(flags) > 3 else ""
        return (
            f"{len(flags)} product(s) below the {min_margin_pct:g}% margin floor: "
            f"{names}{more}. Review costs or set new prices in Admin."
        )
