"""Canonical data contracts shared across adapters (PDF / Excel / ERP).

This is the "universal language" every adapter must speak. Whoever builds an
adapter is free to use any technique inside (regex, LLM, pandas, XML...) as long
as it returns these types. Reconciliation and the rules engine only ever see
these — never the raw source.

Only ERPEntry is finalised here (Person C). Supplier / PurchaseOrder /
InvoiceData are stubbed for Persons B and A to fill in against the same style.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class ERPEntry(BaseModel):
    """One accounting entry (asiento) from the legacy ERP bridge.

    The ERP is the AUTHORITATIVE reconciliation source: `status` (PENDIENTE /
    PAGADA) and `expected_amount` are the truth for "already paid?" and "how much
    was really owed?". The Excel's own Estado column is NOT authoritative.
    """

    asiento_id: str                 # <id>        e.g. "AS-00084"
    purchase_order: str             # <pedido>    e.g. "PO-2026-0084"
    supplier_id: str                # <proveedor> e.g. "P002"
    tax_id: str                     # <nif>       e.g. "A41220987"
    expected_amount: Decimal        # <importe>   parsed from "6.199,54"
    status: str                     # <estado>    "PENDIENTE" | "PAGADA"
    date: date                      # <fecha>     parsed from "21/03/2026"


# --- stubs for the other two adapters (owners: A = PDF, B = Excel) ---

class Supplier(BaseModel):
    id: str
    name: str
    tax_id: str
    iban: str                       # needed for rule 1 (invoice IBAN must match)
    payment_terms: str | None = None


class PurchaseOrder(BaseModel):
    id: str
    supplier_id: str
    tax_id: str | None = None
    amount: Decimal                 # invoice TOTAL must equal this (±0.01)


class InvoiceData(BaseModel):
    file_id: str                    # exact PDF filename (this is the output id)
    invoice_number: str | None = None
    purchase_order: str | None = None
    supplier_name: str | None = None
    supplier_tax_id: str | None = None      # NIF
    supplier_iban: str | None = None        # rule 1
    issue_date: date | None = None
    base: Decimal | None = None             # rule 3
    iva_amount: Decimal | None = None       # rule 3
    iva_rate: Decimal | None = None
    total: Decimal | None = None            # rule 2 (matches pedido amount)
