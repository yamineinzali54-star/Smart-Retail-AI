"""Forecasting schemas."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ReorderSuggestion:
    product_id: str
    avg_daily_sales: float
    on_hand: float
    suggested_qty: float

    @property
    def needs_order(self) -> bool:
        return self.suggested_qty > 0
