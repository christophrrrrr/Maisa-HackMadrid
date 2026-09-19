from pathlib import Path

from src.extract_xml import extract_xml


def test_facturae_reader_can_be_disabled(tmp_path: Path):
    invoice = tmp_path / "invoice.xml"
    invoice.write_text("<Invoice><ID>INV-1</ID></Invoice>", encoding="utf-8")

    extracted = extract_xml(invoice, facturae=False)

    assert extracted.extraction_ok is False
    assert extracted.extraction_reason == "unknown_format"
    assert extracted.extraction_note == "lectura FacturaE / UBL desactivada"
