"""Optional LLM narration over computed ops alerts. Rule-based fallback so
the alert tables never depend on AI availability."""

from __future__ import annotations

from typing import Any

from app.core.llm.base import BaseLLMProvider

OPS_ALERTS_SYSTEM_PROMPT = """You summarize retail operations alerts for a small shop owner.
Rules:
- 2-3 short sentences with the key numbers. Money is in kyat (K).
- Prioritize dead stock capital, the largest supplier price jumps, and cashier outliers.
- Never invent numbers not present in the input. If there are no alerts, say the shop looks clean.
- Answer in {language}.
"""


class OpsAlertsNarrator:
    def __init__(self, llm: BaseLLMProvider | None = None):
        self._llm = llm

    def narrate(
        self,
        *,
        counts: dict[str, int],
        dead: list[dict[str, Any]],
        price: list[dict[str, Any]],
        abuse: list[dict[str, Any]],
        locale: str = "en",
    ) -> str:
        fallback = self.fallback(counts)
        # getattr: callers may pass duck-typed fakes that aren't providers.
        # offline stub = missing API key -> rule-based prose, never canned SQL.
        if self._llm is None or getattr(self._llm, "offline", False):
            return fallback
        language = "Myanmar" if locale == "my" else "English"
        top_dead = [
            f"{d.get('product_name') or d.get('product_id')} (K {d.get('stock_value')})"
            for d in dead[:3]
        ]
        top_price = [
            f"{p.get('product_name') or p.get('product_id')} (+{p.get('change_pct')}%)"
            for p in price[:3]
        ]
        top_abuse = [
            f"{a.get('cashier')} ({a.get('void_rate_pct')}% void)" for a in abuse[:3]
        ]
        try:
            text = self._llm.complete(
                f"Dead stock: {counts.get('dead_stock', 0)} (top: {top_dead}). "
                f"Supplier price flags: {counts.get('price_flags', 0)} (top: {top_price}). "
                f"Cashier abuse flags: {counts.get('abuse_flags', 0)} (top: {top_abuse}).",
                system=OPS_ALERTS_SYSTEM_PROMPT.format(language=language),
            )
            return text.strip() or fallback
        except Exception:
            return fallback

    @staticmethod
    def fallback(counts: dict[str, int]) -> str:
        dead = int(counts.get("dead_stock", 0))
        price = int(counts.get("price_flags", 0))
        abuse = int(counts.get("abuse_flags", 0))
        if dead == price == abuse == 0:
            return "No operational alerts: no dead stock, supplier price drift, or cashier outliers."
        parts = []
        if dead:
            parts.append(f"{dead} dead-stock product(s)")
        if price:
            parts.append(f"{price} supplier price flag(s)")
        if abuse:
            parts.append(f"{abuse} cashier outlier(s)")
        return "Needs attention: " + ", ".join(parts) + "."
