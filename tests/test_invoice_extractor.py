from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from src.invoice_extractor import extract_pdf


ROOT = Path(__file__).resolve().parents[1]
INVOICES = ROOT / "challenge" / "facturas"


def _extract(name: str):
    return extract_pdf(INVOICES / name, use_vision=False)


def test_standard_template():
    inv = _extract("2026-01-08_P001.pdf").invoice
    assert inv.invoice_number == "2026/11604"
    assert inv.purchase_order == "PO-2026-0096"
    assert inv.supplier_tax_id == "B46102331"
    assert inv.supplier_iban == "ES2100491500051234567890"
    assert inv.base == Decimal("2489.99")
    assert inv.iva_amount == Decimal("522.90")
    assert inv.total == Decimal("3012.89")
    assert inv.extraction_ok


@pytest.mark.parametrize(
    ("name", "template", "expected"),
    [
        ("2026-01-08_P001.pdf", "standard", {
            "invoice_number": "2026/11604", "purchase_order": "PO-2026-0096",
            "supplier_tax_id": "B46102331", "supplier_iban": "ES2100491500051234567890",
            "issue_date": date(2026, 1, 8), "base": Decimal("2489.99"),
            "iva_amount": Decimal("522.90"), "total": Decimal("3012.89"),
        }),
        ("2026-01-14_P002.pdf", "ref_uppercase", {
            "invoice_number": "FA-2954", "purchase_order": "PO-2026-0144",
            "supplier_tax_id": "A41220987", "supplier_iban": "ES7621000813610123456789",
            "issue_date": date(2026, 1, 14), "base": Decimal("2452.27"),
            "iva_amount": Decimal("514.98"), "total": Decimal("2967.25"),
        }),
        ("2026-01-15_P003.pdf", "narrative", {
            "invoice_number": "F26-9524", "purchase_order": "PO-2026-0070",
            "supplier_tax_id": "B30455812", "supplier_iban": "ES6001825322180201588391",
            "issue_date": date(2026, 1, 15), "base": Decimal("6543.49"),
            "iva_amount": Decimal("1374.13"), "total": Decimal("7917.62"),
        }),
        ("2026-01-24_P009.pdf", "simplified", {
            "invoice_number": "2026/25704", "purchase_order": "PO-2026-0220",
            "supplier_tax_id": "A46311208", "supplier_iban": "ES8201280011230100044571",
            "issue_date": date(2026, 1, 24), "base": Decimal("2301.34"),
            "iva_amount": Decimal("483.28"), "total": Decimal("2784.62"),
        }),
        ("F26-3011_suministros.pdf", "modern", {
            "invoice_number": "F26-3011", "purchase_order": "PO-2026-1201",
            "supplier_tax_id": "B46102331", "supplier_iban": "ES2100491500051234567890",
            "issue_date": date(2026, 3, 12), "base": Decimal("1420.00"),
            "iva_amount": Decimal("298.20"), "total": Decimal("1718.20"),
        }),
        ("2026-0233-A_catering.pdf", "invoice_en", {
            "invoice_number": "2026/0233-A", "purchase_order": "PO-2026-0492",
            "supplier_tax_id": "B96233419", "supplier_iban": "ES1800815290070001234567",
            "issue_date": date(2026, 4, 11), "base": Decimal("1250.00"),
            "iva_amount": Decimal("262.50"), "total": Decimal("1512.50"),
        }),
        ("2026-01-25_P001.pdf", "modern", {
            "invoice_number": "2026/84946", "purchase_order": "PO-2026-0469",
            "supplier_tax_id": "B46102331", "supplier_iban": "ES2100491500051234567890",
            "issue_date": date(2026, 1, 25), "base": Decimal("4808.25"),
            "iva_amount": Decimal("1009.73"), "total": Decimal("5817.98"),
        }),
    ],
)
def test_representative_digital_templates_exact_values(name, template, expected):
    record = _extract(name)
    assert record.template == template
    assert record.invoice.extraction_ok
    for field, value in expected.items():
        assert getattr(record.invoice, field) == value


def test_image_pdf_degrades_explicitly_without_vision():
    record = _extract("scan_001.pdf")
    assert record.method == "unavailable"
    assert not record.invoice.extraction_ok
    assert "vision disabled" in (record.invoice.extraction_note or "")


def test_invalid_printed_date_is_a_business_warning_not_an_ocr_failure():
    record = _extract("FA-1123_construcciones.pdf")
    assert record.invoice.extraction_ok
    assert record.invoice.issue_date is None
    assert "invalid issue date" in record.warnings


def test_every_digital_pdf_extracts_required_fields():
    records = [extract_pdf(path, use_vision=False) for path in sorted(INVOICES.glob("*.pdf"))]
    digital = [record for record in records if record.method == "embedded_text"]
    scans = [record for record in records if record.method == "unavailable"]
    assert len(digital) == 471
    assert len(scans) == 29
    failures = [record.invoice.file_id for record in digital if not record.invoice.extraction_ok]
    assert failures == []


def test_clear_vision_cache_removes_json_files(tmp_path):
    from src.invoice_extractor import clear_vision_cache

    cache = tmp_path / "invoice_extraction"
    cache.mkdir()
    (cache / "abc.json").write_text("{}", encoding="utf-8")
    (cache / "keep.txt").write_text("no", encoding="utf-8")
    assert clear_vision_cache(cache) == 1
    assert not (cache / "abc.json").exists()
    assert (cache / "keep.txt").exists()
