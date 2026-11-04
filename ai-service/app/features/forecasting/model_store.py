"""Read side of the forecasting model store.

The trained model lives on disk next to the dataset it was built from
(artifacts/forecast/active.json). The serving job loads it here; when no
model has been trained yet the caller falls back to the moving-average
baseline, so the page keeps working before the first training run.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .seasonal import SeasonalModel


def artifact_root() -> Path:
    """Configured artifact directory (AI_ARTIFACT_DIR)."""
    from app.config import settings

    return Path(settings.ai_artifact_dir)


def active_model_path(root: Path | None = None) -> Path:
    return (root or artifact_root()) / "active.json"


def load_active_model(
    root: Path | None = None, *, branch_id: str | None = None
) -> SeasonalModel | None:
    """Load the active model, or None when there is none for this branch.

    A model trained for another branch is ignored (branch_id "" means the
    model was trained without a branch scope and is treated as universal).
    """
    path = active_model_path(root)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    model_payload = payload.get("model")
    if not isinstance(model_payload, dict):
        return None
    if branch_id:
        model_branch = str(payload.get("branch_id") or "")
        if model_branch and model_branch != branch_id:
            return None
    return SeasonalModel.from_dict(model_payload)


def active_model_info(root: Path | None = None) -> dict[str, Any] | None:
    """Raw active.json payload (for the UI: metrics, trained_at, run_dir)."""
    path = active_model_path(root)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def list_runs(root: Path | None = None) -> list[dict[str, Any]]:
    """Every training run on disk, newest first (model + metrics summary)."""
    base = (root or artifact_root()) / "runs"
    if not base.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for run_dir in sorted(base.iterdir(), reverse=True):
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        model_payload: dict[str, Any] = {}
        model_path = run_dir / "model.json"
        if model_path.exists():
            try:
                model_payload = json.loads(model_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                model_payload = {}
        metrics_payload: dict[str, Any] = {}
        metrics_path = run_dir / "metrics.json"
        if metrics_path.exists():
            try:
                metrics_payload = json.loads(metrics_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                metrics_payload = {}
        test = metrics_payload.get("test", {}) if isinstance(metrics_payload, dict) else {}
        out.append({
            "run_id": run_dir.name,
            "run_dir": str(run_dir),
            "branch_id": manifest.get("branch_id", ""),
            "branch_code": manifest.get("branch_code", ""),
            "trained_at": manifest.get("trained_at", ""),
            "model": model_payload,
            "test_mae": (test.get("model", {}) or {}).get("mae"),
            "baseline_mae": {
                name: values.get("mae")
                for name, values in (test.get("baselines", {}) or {}).items()
            },
            "dataset": manifest.get("prepared_dataset", {}),
        })
    return out
