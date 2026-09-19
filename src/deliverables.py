"""Validation helpers for the two JSONL files cloned by the organisers."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Iterable


ALLOWED_RESULTS = {"PAGAR", "NO_PAGAR", "ESCALAR"}


def validate_outcomes(path: Path, expected_file_ids: Iterable[str]) -> dict:
    """Validate JSONL syntax, values and exact one-to-one file coverage."""
    expected = set(expected_file_ids)
    rows: list[dict] = []
    errors: list[str] = []

    if not path.is_file():
        raise ValueError(f"missing outcomes file: {path}")

    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            errors.append(f"line {line_number}: blank line")
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            errors.append(f"line {line_number}: invalid JSON ({exc.msg})")
            continue
        if not isinstance(row, dict):
            errors.append(f"line {line_number}: expected JSON object")
            continue
        file_id = row.get("file_id")
        result = row.get("result")
        if not isinstance(file_id, str) or not file_id:
            errors.append(f"line {line_number}: invalid file_id")
            continue
        if result not in ALLOWED_RESULTS:
            errors.append(f"line {line_number}: invalid result {result!r}")
            continue
        rows.append(row)

    counts = Counter(row["file_id"] for row in rows)
    duplicates = sorted(file_id for file_id, count in counts.items() if count > 1)
    actual = set(counts)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if duplicates:
        errors.append(f"duplicate file_id values: {duplicates}")
    if missing:
        errors.append(f"missing file_id values: {missing}")
    if extra:
        errors.append(f"unknown file_id values: {extra}")
    if errors:
        raise ValueError("; ".join(errors))

    results = Counter(row["result"] for row in rows)
    return {
        "path": str(path),
        "total": len(rows),
        "PAGAR": results["PAGAR"],
        "NO_PAGAR": results["NO_PAGAR"],
        "ESCALAR": results["ESCALAR"],
    }


def _main() -> int:
    ap = argparse.ArgumentParser(description="Validate an outcomes JSONL artifact.")
    ap.add_argument("--out", required=True, help="outcomes JSONL path")
    ap.add_argument("--dir", required=True, help="directory containing the batch PDFs")
    args = ap.parse_args()

    invoice_dir = Path(args.dir)
    expected = sorted(path.name for path in invoice_dir.glob("*.pdf") if path.is_file())
    if not expected:
        raise SystemExit(f"no PDF invoices found in {invoice_dir}")
    print(json.dumps(validate_outcomes(Path(args.out), expected), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
