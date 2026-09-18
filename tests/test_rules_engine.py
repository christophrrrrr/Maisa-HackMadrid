"""Unit tests for the Norma v3 rules engine — run without A/B/C being live.

Synthetic InvoiceData is fed through the pure decision function so we can pin
every PAGAR / NO_PAGAR / ESCALAR branch. Run: `python -m pytest tests/ -q`
or `python tests/test_rules_engine.py`.
"""
from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.business_data import BusinessData
from src.models import ERPEntry, InvoiceData, PurchaseOrder, Supplier
from src.rules_engine import decide_batch, evaluate

TODAY = date(2026, 9, 18)
IBAN = "ES60 0182 5322 1802 0158 8391"
IBAN_NORM = "ES6001825322180201588391"


def _biz() -> BusinessData:
    sup = Supplier(id="P003", name="Ofimatica Cieza S.L.", tax_id="B30455812",
                   iban=IBAN_NORM, payment_terms="60 dias")
    order = PurchaseOrder(id="PO-2026-0132", supplier_id="P003", tax_id="B30455812",
                          amount=Decimal("6953.04"))
    return BusinessData(
        suppliers_by_id={"P003": sup}, suppliers_by_nif={"B30455812": sup},
        orders={"PO-2026-0132": order}, rules_version="norma-v3", rules_text=[],
    )


def _erp(status="PENDIENTE", amount="6953.04") -> dict[str, ERPEntry]:
    return {"PO-2026-0132": ERPEntry(
        asiento_id="AS-00132", purchase_order="PO-2026-0132", supplier_id="P003",
        tax_id="B30455812", expected_amount=Decimal(amount), status=status,
        date=date(2026, 4, 28))}


def _invoice(**over) -> InvoiceData:
    base = dict(file_id="f.pdf", invoice_number="F26-8881", purchase_order="PO-2026-0132",
                supplier_name="Ofimatica Cieza S.L.", supplier_tax_id="B30455812",
                supplier_iban=IBAN, issue_date=date(2026, 4, 28), base=Decimal("5746.31"),
                iva_amount=Decimal("1206.73"), iva_rate=Decimal("21"), total=Decimal("6953.04"))
    base.update(over)
    return InvoiceData(**base)


def _run(inv, **kw):
    return evaluate(inv, _biz(), _erp(**kw.pop("erp", {})), today=TODAY, **kw)


def test_clean_invoice_pays():
    out = _run(_invoice())
    assert out.result == "PAGAR"
    assert out.evidence["erp_asiento"] == "AS-00132"


def test_unknown_supplier_escalates():
    assert _run(_invoice(supplier_tax_id="B99999999")).reason == "supplier_not_in_master"
    assert _run(_invoice(supplier_tax_id="B99999999")).result == "ESCALAR"


def test_iban_mismatch_escalates():
    out = _run(_invoice(supplier_iban="ES00 0000 0000 0000 0000 0000"))
    assert out.result == "ESCALAR" and "iban_mismatch" in out.findings


def test_pedido_not_found_escalates():
    out = _run(_invoice(purchase_order="PO-2026-9999"))
    assert out.result == "ESCALAR" and "pedido_not_found" in out.findings


def test_amount_mismatch_escalates():
    out = _run(_invoice(total=Decimal("7000.00"), base=Decimal("5786.78"),
                        iva_amount=Decimal("1213.22")))
    assert out.result == "ESCALAR" and "amount_mismatch" in out.findings


def test_bad_iva_escalates():
    out = _run(_invoice(iva_amount=Decimal("999.99"), total=Decimal("6746.30")))
    assert out.result == "ESCALAR"
    assert "iva_miscalculated" in out.findings or "total_not_base_plus_iva" in out.findings


def test_future_date_escalates():
    out = _run(_invoice(issue_date=date(2026, 12, 1)))
    assert out.result == "ESCALAR" and "future_date" in out.findings


def test_already_paid_is_no_pagar():
    out = _run(_invoice(), erp={"status": "PAGADA"})
    assert out.result == "NO_PAGAR" and out.reason == "already_paid"


def test_escalar_beats_no_pagar():
    # already paid (NO_PAGAR) + iban mismatch (ESCALAR) -> ESCALAR wins
    out = _run(_invoice(supplier_iban="ES00 0000 0000 0000 0000 0000"), erp={"status": "PAGADA"})
    assert out.result == "ESCALAR"


def test_incomplete_extraction_escalates():
    out = _run(_invoice(total=None, extraction_ok=False, extraction_note="scan unreadable"))
    assert out.result == "ESCALAR" and out.reason == "incomplete_extraction"


def test_duplicate_pedido_in_batch_is_no_pagar():
    a = _invoice(file_id="a.pdf")
    b = _invoice(file_id="b.pdf")
    outs = decide_batch([a, b], _biz(), _erp(), today=TODAY)
    assert all("duplicate_pedido" in o.findings for o in outs)
    assert all(o.result == "NO_PAGAR" for o in outs)


def test_contract_line_is_minimal():
    line = _run(_invoice()).to_contract_line()
    assert set(line.keys()) == {"file_id", "result"}


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
