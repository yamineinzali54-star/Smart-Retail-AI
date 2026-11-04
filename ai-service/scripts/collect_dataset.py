"""Export the sale + sale_detail join to a CSV artifact (KDD step ①).

The database is read exactly once; every later KDD step works on the file.

    python scripts/collect_dataset.py --branch YGN
    python scripts/collect_dataset.py --branch YGN --prepare
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.features.forecasting.dataset import (  # noqa: E402
    collect_raw_csv,
    prepare_from_csv,
)
from app.services.factory import get_db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", default="YGN", help="branch code (default YGN)")
    parser.add_argument(
        "--out-dir", default=None,
        help="artifact directory (default AI_ARTIFACT_DIR)",
    )
    parser.add_argument(
        "--prepare", action="store_true",
        help="also build dataset_prepared.csv from the raw file",
    )
    args = parser.parse_args()

    artifact_dir = Path(args.out_dir or settings.ai_artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    raw_path = artifact_dir / "dataset_raw.csv"

    db = get_db()
    rows = db.fetch_all("SELECT id FROM branch WHERE code = %s", (args.branch,))
    if not rows:
        print(f"branch not found: {args.branch}")
        return 1
    branch_id = str(rows[0]["id"])

    print(f"collecting {args.branch} -> {raw_path}")
    manifest = collect_raw_csv(db, branch_id, raw_path)
    print(json.dumps(manifest, indent=2))

    if args.prepare:
        prepared_path = artifact_dir / "dataset_prepared.csv"
        print(f"preparing -> {prepared_path}")
        prepared = prepare_from_csv(raw_path, prepared_path)
        print(json.dumps(prepared, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
