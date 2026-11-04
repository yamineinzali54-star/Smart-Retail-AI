"""Train the demand forecaster from the CSV artifacts (KDD steps ② + ③).

    python scripts/train_forecast.py --branch YGN
    python scripts/train_forecast.py --branch YGN --collect   # refresh the raw file first

Writes runs/<run_id>/{model,metrics,steps,manifest}.json and updates
active.json — the model the forecast job serves for the coming week.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.features.forecasting.dataset import (  # noqa: E402
    collect_raw_csv,
    prepare_from_csv,
)
from app.features.forecasting.trainer import train  # noqa: E402
from app.services.factory import get_db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", default="YGN", help="branch code (default YGN)")
    parser.add_argument("--out-dir", default=None, help="artifact directory")
    parser.add_argument(
        "--collect", action="store_true",
        help="re-export dataset_raw.csv from the database first",
    )
    parser.add_argument(
        "--no-activate", action="store_true",
        help="do not point active.json at this run",
    )
    args = parser.parse_args()

    artifact_dir = Path(args.out_dir or settings.ai_artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    raw_path = artifact_dir / "dataset_raw.csv"
    prepared_path = artifact_dir / "dataset_prepared.csv"

    if args.collect or not raw_path.exists():
        db = get_db()
        rows = db.fetch_all("SELECT id FROM branch WHERE code = %s", (args.branch,))
        if not rows:
            print(f"branch not found: {args.branch}")
            return 1
        print(f"collecting {args.branch} -> {raw_path}")
        print(json.dumps(collect_raw_csv(db, str(rows[0]["id"]), raw_path), indent=2))

    if not prepared_path.exists() or args.collect:
        # Re-prepare whenever the raw dataset was refreshed — otherwise the
        # model would be fitted on a stale prepared copy.
        print(f"preparing -> {prepared_path}")
        print(json.dumps(prepare_from_csv(raw_path, prepared_path), indent=2))

    run_name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "_" + args.branch
    run_dir = artifact_dir / "runs" / run_name
    print(f"training -> {run_dir}")
    branch_id = ""
    try:
        db = get_db()
        rows = db.fetch_all("SELECT id FROM branch WHERE code = %s", (args.branch,))
        if rows:
            branch_id = str(rows[0]["id"])
    except Exception as exc:  # the model still trains without a branch scope
        print(f"warning: could not resolve branch id: {exc}")
    result = train(
        run_dir, prepared_path, activate=not args.no_activate,
        dataset_meta={"prepared": str(prepared_path)},
        branch_id=branch_id, branch_code=args.branch,
        active_path=artifact_dir / "active.json",
    )
    print(json.dumps(result["metrics"]["test"], indent=2))
    print(f"active model: {artifact_dir / 'active.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
