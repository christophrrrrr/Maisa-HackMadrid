from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from src.manual_overrides import apply_override
from src.models import InvoiceData


def test_applies_checksum_bound_override(tmp_path: Path):
    source = tmp_path / "scan.pdf"
    source.write_bytes(b"invoice bytes")
    checksum = hashlib.sha256(source.read_bytes()).hexdigest()
    invoice = InvoiceData(
        file_id="scan.pdf",
        supplier_tax_id=None,
        extraction_ok=False,
        extraction_note="missing field: supplier_tax_id",
    )

    corrected, applied = apply_override(
        invoice,
        source,
        {
            "scan.pdf": {
                "sha256": checksum,
                "fields": {
                    "supplier_tax_id": "B90233808",
                    "extraction_ok": True,
                    "extraction_note": "human verified",
                },
            }
        },
    )

    assert applied
    assert corrected.supplier_tax_id == "B90233808"
    assert corrected.extraction_ok
    assert corrected.extraction_note == "human verified"


def test_rejects_override_if_document_changed(tmp_path: Path):
    source = tmp_path / "scan.pdf"
    source.write_bytes(b"changed invoice")
    invoice = InvoiceData(file_id="scan.pdf", extraction_ok=False)

    with pytest.raises(ValueError, match="hash mismatch"):
        apply_override(
            invoice,
            source,
            {"scan.pdf": {"sha256": "0" * 64, "fields": {"extraction_ok": True}}},
        )
