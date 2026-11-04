"""Optional LLM narration over market-basket rules. Rule-based fallback so
the basket page never depends on AI availability."""

from __future__ import annotations

from typing import Any

from app.core.llm.base import BaseLLMProvider

BASKET_SYSTEM_PROMPT = """You summarize market-basket analysis for a small shop owner.
Rules:
- 2-3 short sentences with the key numbers.
- Name the top co-purchase pairs worth bundling. Promotion drafts stay DRAFT until the Admin activates them.
- Never invent numbers not present in the input. If no pairs were found, say sales history is too thin.
- Answer in {language}.
"""


class BasketNarrator:
    def __init__(self, llm: BaseLLMProvider | None = None):
        self._llm = llm

    def narrate(
        self,
        *,
        rules: list[dict[str, Any]],
        drafts: list[dict[str, Any]],
        transaction_count: int,
        days: int,
        locale: str = "en",
    ) -> str:
        fallback = self.fallback(rules, transaction_count, days)
        if self._llm is None or getattr(self._llm, "offline", False):
            return fallback
        language = "Myanmar" if locale == "my" else "English"
        top = [
            f"{r.get('antecedent_name') or r.get('antecedent')} + "
            f"{r.get('consequent_name') or r.get('consequent')} "
            f"(confidence {r.get('confidence')}, lift {r.get('lift')})"
            for r in rules[:3]
        ]
        try:
            text = self._llm.complete(
                f"Transactions analyzed: {transaction_count} over the last {days} days. "
                f"Co-purchase rules: {len(rules)}. Promotion drafts: {len(drafts)}. "
                f"Top pairs: {top}",
                system=BASKET_SYSTEM_PROMPT.format(language=language),
            )
            return text.strip() or fallback
        except Exception:
            return fallback

    @staticmethod
    def fallback(rules: list[dict[str, Any]], transaction_count: int, days: int) -> str:
        if not rules:
            return (
                f"Not enough co-purchase activity in the last {days} days "
                f"({transaction_count} multi-item transaction(s)) — bundles appear after more linked sales."
            )
        names = ", ".join(
            f"{r.get('antecedent_name') or r.get('antecedent')} + "
            f"{r.get('consequent_name') or r.get('consequent')}"
            for r in rules[:2]
        )
        more = f" (+{len(rules) - 2} more)" if len(rules) > 2 else ""
        return (
            f"Found {len(rules)} co-purchase rule(s) from {transaction_count} "
            f"multi-item transaction(s) over {days} days. Top pairs: {names}{more}."
        )
