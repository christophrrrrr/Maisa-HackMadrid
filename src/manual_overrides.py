"""Auditable human corrections for fields that automated extraction could not read.

Overrides are bound to both the exact filename and the PDF content hash.  This
prevents a correction from being silently reused if a document is replaced.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .models import InvoiceData


REPO = Path(__file__).resolve().parents[1]
DEFAULT_OVERRIDES = REPO / "config" / "manual_extraction_overrides.json"


def load_overrides(path: Path = DEFAULT_OVERRIDES) -> dict[str, dict]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"manual overrides must be a JSON object: {path}")
    return raw


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def apply_override(
    invoice: InvoiceData,
    source: Path,
    overrides: dict[str, dict],
) -> tuple[InvoiceData, bool]:
    """Apply a checksum-bound override, returning ``(invoice, applied)``."""
    spec = overrides.get(invoice.file_id)
    if spec is None:
        return invoice, False
    if not isinstance(spec, dict):
        raise ValueError(f"invalid manual override for {invoice.file_id}")

    expected_hash = spec.get("sha256")
    if not expected_hash:
        raise ValueError(f"manual override for {invoice.file_id} has no sha256")
    actual_hash = _sha256(source)
    if actual_hash != expected_hash:
        raise ValueError(
            f"manual override hash mismatch for {invoice.file_id}: "
            f"expected {expected_hash}, got {actual_hash}"
        )

    fields = spec.get("fields")
    if not isinstance(fields, dict) or not fields:
        raise ValueError(f"manual override for {invoice.file_id} has no fields")
    unknown = set(fields) - set(InvoiceData.model_fields)
    if unknown:
        raise ValueError(
            f"manual override for {invoice.file_id} has unknown fields: {sorted(unknown)}"
        )
    if "file_id" in fields:
        raise ValueError(f"manual override cannot change file_id: {invoice.file_id}")

    corrected = invoice.model_copy(update=fields)
    return InvoiceData.model_validate(corrected.model_dump()), True
