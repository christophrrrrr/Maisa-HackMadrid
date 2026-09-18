"""Business-data adapter (Person B, part 1).

Loads the ONE useful part of the chaotic Excel — the supplier master, the 2026
purchase orders, and the payment rules text — into clean lookups. Ignores the
~11 junk/trap sheets. De-dups the duplicated P007 master row.

Everything the rules engine needs about "who is a real supplier / what was
ordered" comes from here; "was it already paid / still pending" comes from the
ERP snapshot (Person C).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

import openpyxl

from .models import PurchaseOrder, Supplier

DEFAULT_XLSX = Path(__file__).resolve().parents[1] / "challenge" / "FINAL_v7_DEFINITIVO_ahorasi.xlsx"

SHEET_SUPPLIERS = "Proveedores"
SHEET_ORDERS = "Pedidos_2026"
SHEET_RULES = "Norma_Pagos_v3"


def normalize_iban(iban: str | None) -> str | None:
    if iban is None:
        return None
    return re.sub(r"\s+", "", str(iban)).upper()


def _to_decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        # Excel gives floats; str() gives the shortest exact repr (10325.9 -> "10325.9")
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


@dataclass
class BusinessData:
    suppliers_by_id: dict[str, Supplier]
    suppliers_by_nif: dict[str, Supplier]
    orders: dict[str, PurchaseOrder]
    rules_version: str
    rules_text: list[str]
    warnings: list[str] = field(default_factory=list)

    def supplier_for_invoice(self, nif: str | None) -> Supplier | None:
        """Rule 1: a real supplier is matched by NIF (invoices carry NIF, not ID)."""
        if not nif:
            return None
        return self.suppliers_by_nif.get(nif.strip())

    def order(self, pedido: str | None) -> PurchaseOrder | None:
        if not pedido:
            return None
        return self.orders.get(pedido.strip())


def load_business_data(xlsx_path: Path = DEFAULT_XLSX) -> BusinessData:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    warnings: list[str] = []

    # --- suppliers (master) ---
    suppliers_by_id: dict[str, Supplier] = {}
    suppliers_by_nif: dict[str, Supplier] = {}
    ws = wb[SHEET_SUPPLIERS]
    for row in ws.iter_rows(min_row=2, values_only=True):
        sid = row[0]
        if not sid:
            continue
        supplier = Supplier(
            id=str(sid).strip(),
            name=str(row[1]).strip() if row[1] else "",
            tax_id=str(row[2]).strip() if row[2] else "",
            iban=normalize_iban(row[3]) or "",
            payment_terms=str(row[5]).strip() if row[5] else None,
        )
        if supplier.id in suppliers_by_id:
            existing = suppliers_by_id[supplier.id]
            if existing.model_dump() != supplier.model_dump():
                warnings.append(f"supplier {supplier.id} duplicated with CONFLICTING data — kept first")
            else:
                warnings.append(f"supplier {supplier.id} duplicated (identical) — de-duped")
            continue
        suppliers_by_id[supplier.id] = supplier
        if supplier.tax_id:
            if supplier.tax_id in suppliers_by_nif:
                warnings.append(f"NIF {supplier.tax_id} maps to multiple supplier ids")
            suppliers_by_nif[supplier.tax_id] = supplier

    # --- purchase orders ---
    orders: dict[str, PurchaseOrder] = {}
    ws = wb[SHEET_ORDERS]
    for row in ws.iter_rows(min_row=2, values_only=True):
        pedido = row[0]
        if not pedido:
            continue
        amount = _to_decimal(row[3])
        if amount is None:
            warnings.append(f"order {pedido} has unparseable amount {row[3]!r} — skipped")
            continue
        po = PurchaseOrder(
            id=str(pedido).strip(),
            supplier_id=str(row[1]).strip() if row[1] else "",
            tax_id=str(row[2]).strip() if row[2] else None,
            amount=amount,
        )
        if po.id in orders:
            warnings.append(f"order {po.id} appears more than once in {SHEET_ORDERS}")
        orders[po.id] = po

    # --- rules text (kept for the pitch / versioning; the logic is coded in rules_engine) ---
    rules_text: list[str] = []
    if SHEET_RULES in wb.sheetnames:
        for row in wb[SHEET_RULES].iter_rows(values_only=True):
            if row and row[0]:
                rules_text.append(str(row[0]).strip())
    rules_version = "norma-v3"

    wb.close()
    return BusinessData(
        suppliers_by_id=suppliers_by_id,
        suppliers_by_nif=suppliers_by_nif,
        orders=orders,
        rules_version=rules_version,
        rules_text=rules_text,
        warnings=warnings,
    )


def _main() -> int:
    biz = load_business_data()
    print(f"suppliers : {len(biz.suppliers_by_id)} (by NIF: {len(biz.suppliers_by_nif)})")
    print(f"orders    : {len(biz.orders)}")
    print(f"rules     : {biz.rules_version} ({len(biz.rules_text)} lines)")
    print(f"warnings  : {biz.warnings}")
    any_id = next(iter(biz.suppliers_by_id))
    print("sample supplier:", biz.suppliers_by_id[any_id].model_dump())
    any_po = next(iter(biz.orders))
    print("sample order   :", biz.orders[any_po].model_dump())
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
