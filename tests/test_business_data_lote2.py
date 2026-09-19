"""Lote 2 business-data ingestion: foreign-supplier / new-order CSV merge and the
norma-v4 text fallback. Uses the real master Excel and the shipped lote 2 CSVs.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.business_data import load_business_data  # noqa: E402

XLSX = ROOT / "challenge" / "FINAL_v7_DEFINITIVO_ahorasi.xlsx"
SUPPLIERS_CSV = ROOT / "lote_2_sorpresa" / "proveedores_nuevos.csv"
ORDERS_CSV = ROOT / "lote_2_sorpresa" / "pedidos_nuevos.csv"

pytestmark = pytest.mark.skipif(
    not (XLSX.is_file() and SUPPLIERS_CSV.is_file() and ORDERS_CSV.is_file()),
    reason="requires the master Excel and the lote 2 CSVs to be present",
)


def _load():
    return load_business_data(
        XLSX,
        rules_version="norma-v4",
        extra_supplier_csvs=[SUPPLIERS_CSV],
        extra_order_csvs=[ORDERS_CSV],
    )


def test_v4_without_sheet_does_not_crash_and_falls_back_to_v3_text():
    biz = _load()
    assert biz.rules_version == "norma-v4"
    assert biz.rules_text, "expected rule text carried from the v3 fallback sheet"
    assert any("norma-v4" in w.lower() for w in biz.warnings)


def test_foreign_suppliers_are_merged_from_csv():
    biz = _load()
    for supplier_id in ("P012", "P013", "P014", "P015"):
        assert supplier_id in biz.suppliers_by_id, f"{supplier_id} missing"
    german = biz.suppliers_by_id["P012"]
    # foreign IBAN normalised (spaces stripped, upper-cased), foreign NIF kept
    assert german.iban == "DE89370400440532013000"
    assert biz.supplier_for_invoice("DE812345678") is german


def test_new_orders_are_merged_from_csv():
    biz = _load()
    # a foreign-supplier order and a plain new one both become visible
    assert biz.order("PO-2026-1306") is not None      # P013 (French)
    assert biz.order("PO-2026-0500") is not None      # P002 (new pedido)
    assert biz.order("PO-2026-1308").supplier_id == "P012"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
