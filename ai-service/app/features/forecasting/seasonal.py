"""Additive seasonal-trend forecaster — pure standard library.

    y_hat[t] = level[t] + seasonal[weekday(t)]

level     trailing mean over the last `window` days, optionally damped
          (alpha=1.0 → plain trailing mean, alpha=0 → frozen level)
seasonal  mean residual per weekday over the TRAINING window, mean-centred
          so the seasonal profile does not shift the overall level

The forecaster is deliberately transparent: the fitted parameters are a
small JSON-serialisable dict, which is what gets stored as the model
artifact and shown in the UI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

DEFAULT_WINDOW = 7
DEFAULT_ALPHA = 1.0
WEEKDAYS = 7


@dataclass
class SeasonalModel:
    """Fitted model parameters (JSON-serialisable).

    Every product keeps its OWN weekly profile: a shop sells more on the
    weekend for some products and more mid-week for others, so a single
    shared profile would flatten that signal. `seasonal` is the fallback
    used for products that are not in `seasonal_by_product`.
    """

    window: int = DEFAULT_WINDOW
    alpha: float = DEFAULT_ALPHA
    seasonal: list[float] = field(default_factory=lambda: [0.0] * WEEKDAYS)
    seasonal_by_product: dict[str, list[float]] = field(default_factory=dict)
    level_last: float = 0.0
    train_end: int = 0
    trained_at: str = ""

    def profile_for(self, product_id: str | None = None) -> list[float]:
        """Weekly profile for one product (falls back to the global one)."""
        if product_id:
            profile = self.seasonal_by_product.get(product_id)
            if profile:
                return profile
        return self.seasonal

    def to_dict(self) -> dict[str, Any]:
        return {
            "algorithm": "additive_seasonal_trend",
            "window": self.window,
            "alpha": self.alpha,
            "seasonal": [round(value, 6) for value in self.seasonal],
            "seasonal_by_product": {
                product_id: [round(value, 6) for value in profile]
                for product_id, profile in self.seasonal_by_product.items()
            },
            "level_last": round(self.level_last, 6),
            "train_end": self.train_end,
            "trained_at": self.trained_at,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SeasonalModel":
        return cls(
            window=int(payload.get("window", DEFAULT_WINDOW)),
            alpha=float(payload.get("alpha", DEFAULT_ALPHA)),
            seasonal=[float(v) for v in payload.get("seasonal", [0.0] * WEEKDAYS)],
            seasonal_by_product={
                str(product_id): [float(v) for v in profile]
                for product_id, profile in (
                    payload.get("seasonal_by_product") or {}
                ).items()
            },
            level_last=float(payload.get("level_last", 0.0)),
            train_end=int(payload.get("train_end", 0)),
            trained_at=str(payload.get("trained_at", "")),
        )


def weekday_indices(days: list[str]) -> list[int]:
    """Map ISO dates to Monday=0 .. Sunday=6 (matches date.weekday())."""
    from datetime import date

    return [date.fromisoformat(day).weekday() for day in days]


def level_series(series: list[float], window: int, alpha: float) -> list[float]:
    """Running level: trailing mean of the last `window` points, damped."""
    if window <= 0:
        raise ValueError("window must be positive")
    if not 0.0 <= alpha <= 1.0:
        raise ValueError("alpha must be in [0, 1]")
    levels: list[float] = []
    for i in range(len(series)):
        chunk = series[max(0, i - window + 1): i + 1]
        raw = sum(chunk) / len(chunk) if chunk else 0.0
        previous = levels[-1] if levels else raw
        levels.append(alpha * raw + (1.0 - alpha) * previous)
    return levels


def seasonal_profile(
    series: list[float], weekdays: list[int], levels: list[float], train_end: int
) -> list[float]:
    """Mean residual per weekday over the training window, mean-centred."""
    totals = [0.0] * WEEKDAYS
    counts = [0] * WEEKDAYS
    for i in range(min(train_end, len(series))):
        weekday = weekdays[i]
        totals[weekday] += series[i] - levels[i]
        counts[weekday] += 1
    profile = [
        (totals[day] / counts[day]) if counts[day] else 0.0 for day in range(WEEKDAYS)
    ]
    # Centre so the seasonal pattern adds no net level shift.
    used = [day for day in range(WEEKDAYS) if counts[day]]
    if used:
        mean = sum(profile[day] for day in used) / len(used)
        profile = [value - mean for value in profile]
    return profile


def predict_range(
    series: list[float],
    weekdays: list[int],
    start: int,
    end: int,
    model: SeasonalModel,
    product_id: str | None = None,
) -> list[float]:
    """Predict values for [start, end) using the model's seasonal profile.

    Each prediction uses history only through the day before its target.
    After scoring a target day, its observed value updates the level for the
    next one-step-ahead prediction.
    """
    prior_levels = level_series(series[:start], model.window, model.alpha)
    level = prior_levels[-1] if prior_levels else 0.0
    profile = model.profile_for(product_id)
    out: list[float] = []
    for i in range(start, min(end, len(series))):
        value = level + profile[weekdays[i]]
        out.append(max(0.0, value))
        chunk = series[max(0, i - model.window + 1): i + 1]
        raw = sum(chunk) / len(chunk) if chunk else 0.0
        level = model.alpha * raw + (1.0 - model.alpha) * level
    return out


def fit(
    series: list[float],
    weekdays: list[int],
    train_end: int,
    *,
    window: int,
    alpha: float,
    product_id: str | None = None,
) -> SeasonalModel:
    """Fit level + seasonal profile on the training window only."""
    if train_end <= 0:
        raise ValueError("train_end must be positive")
    levels = level_series(series, window, alpha)
    profile = seasonal_profile(series, weekdays, levels, train_end)
    model = SeasonalModel(
        window=window,
        alpha=alpha,
        seasonal=profile,
        level_last=levels[train_end - 1] if train_end - 1 < len(levels) else 0.0,
        train_end=train_end,
    )
    if product_id:
        model.seasonal_by_product[product_id] = list(profile)
    return model


def predict_future(
    series: list[float],
    weekdays: list[int],
    horizon: int,
    model: SeasonalModel,
    future_weekdays: list[int] | None = None,
    product_id: str | None = None,
) -> list[float]:
    """Predict the next `horizon` points beyond the end of `series`.

    Used by the serving job (forecast_build) to forecast days that have no
    observed value yet.
    """
    if horizon <= 0:
        return []
    levels = level_series(series, model.window, model.alpha)
    level = levels[-1] if levels else 0.0
    profile = model.profile_for(product_id)
    out: list[float] = []
    for step in range(horizon):
        weekday = (
            future_weekdays[step]
            if future_weekdays and step < len(future_weekdays)
            else 0
        )
        out.append(max(0.0, level + profile[weekday]))
    return out
