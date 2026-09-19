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
from typing import Any, Literal

from pydantic import BaseModel, Field

Result = Literal["PAGAR", "NO_PAGAR", "ESCALAR"]


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
    iva_rate: Decimal | None = None         # percent, e.g. 21 for "IVA (21%)"
    total: Decimal | None = None            # rule 2 (matches pedido amount)
    # A's extractor may set this when a scan can't be read confidently:
    extraction_ok: bool = True
    extraction_note: str | None = None
    # machine-readable triage code when extraction_ok is False, e.g.
    # "incomplete_extraction" | "out_of_scope" | "unreadable" | "unknown_format".
    # the rules engine maps this to the ESCALAR reason so the trace is precise.
    extraction_reason: str | None = None


class CheckValue(BaseModel):
    label: str
    value: Any = None
    source: str


class RuleCheck(BaseModel):
    rule: str
    code: str
    label: str
    status: Literal["pass", "fail", "skipped"]
    result: Result | None = None
    message: str
    actual: CheckValue | None = None
    expected: CheckValue | None = None


class Outcome(BaseModel):
    """Final decision for one invoice. `file_id` + `result` are the delivery
    contract; the rest is trace (judges reward it, the verifier ignores it)."""

    file_id: str
    result: Result
    reason: str                             # primary reason code, e.g. "iban_mismatch"
    detail: str | None = None               # human-readable, may list several findings
    findings: list[str] = Field(default_factory=list)  # every rule that fired
    evidence: dict = Field(default_factory=dict)       # matched reference records
    checks: list[RuleCheck] = Field(default_factory=list)
    rules_version: str = "norma-v3"

    def to_contract_line(self) -> dict:
        """Minimal object for outcomes.jsonl (what the private verifier reads)."""
        return {"file_id": self.file_id, "result": self.result}
