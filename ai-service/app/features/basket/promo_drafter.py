"""Promo drafting (promotion_suggest job, part 2). Builds DRAFT promotion
payloads only: status is always 'draft' + is_ai_suggested True. Activation
is an Admin-only action in the web app (PROJECT_PLAN.md §4 Rule 26) —
this class has no code path that can activate anything."""

from __future__ import annotations


class PromoDrafter:
    def from_rule(
        self, *, antecedent: str, consequent: str, discount_pct: float = 10.0, name: str = ""
    ) -> dict:
        if not 0 < discount_pct <= 90:
            raise ValueError("discount_pct must be in (0, 90]")
        return {
            "name": name or f"Bundle: {antecedent} + {consequent}",
            "type": "bundle",
            "status": "draft",
            "is_ai_suggested": True,
            "discount_pct": discount_pct,
            "product_ids": [antecedent, consequent],
        }

    def activate(self) -> None:
        raise PermissionError("AI must never activate promotions — Admin only")
