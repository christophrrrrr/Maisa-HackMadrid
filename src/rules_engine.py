"""Payment rules engine (Person B, part 2) — Norma de Pagos v3.

Pure, deterministic decision: given the canonical InvoiceData (from A), the
BusinessData (Excel) and the ERP snapshot (C), return an Outcome
(PAGAR / NO_PAGAR / ESCALAR) with reason codes + evidence.

Norma v3 (verbatim intent):
  1. Pay only if NIF is in the master AND the invoice IBAN matches the master.
  2. Pedido must exist, belong to the supplier, and invoice amount == pedido amount (±0.01).
  3. IVA correct and total == base + IVA (±0.01).
  4. Date valid and not in the future.
  5. ERP pedido state must be PENDIENTE; never pay the same pedido twice.
  6. Any anomaly a human should see -> ESCALAR. Reasonable doubt -> escalate, don't pay.

DESIGN DECISIONS (configurable — see POLICY):
  * Precedence ESCALAR > NO_PAGAR > PAGAR (rule 6: when in doubt, escalate).
  * Anomalies/mismatches -> ESCALAR. Only "already paid" / "duplicate pedido"
    (rule 5, would pay twice) -> NO_PAGAR.
  * Amount tolerance 0.01 EUR (rule text). "Not future" is vs a reference date
    (default = today), overridable for reproducible runs.
Every one of these is a documented ADR the judges can challenge; flip them in
POLICY without touching the check logic.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .business_data import BusinessData, normalize_iban
from .models import ERPEntry, InvoiceData, Outcome, Result
from .policy import RULES_VERSION, load_policy

# policy is editable from the console's settings page (outputs/policy.json). it's
# read once per process at import — every run is a fresh process, so edits apply
# on the next batch. reason code -> outcome when that check FAILS.
_cfg = load_policy()
TOLERANCE = Decimal(str(_cfg["tolerance"]))
POLICY: dict[str, Result] = _cfg["reason_outcomes"]  # type: ignore[assignment]

_PRECEDENCE = {"ESCALAR": 2, "NO_PAGAR": 1, "PAGAR": 0}


@dataclass
class Finding:
    code: str
    message: str

    @property
    def result(self) -> Result:
        return POLICY.get(self.code, "ESCALAR")


def _approx(a: Decimal | None, b: Decimal | None, tol: Decimal = TOLERANCE) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= tol


def _iva_rate_fraction(rate: Decimal | None) -> Decimal | None:
    """Accept 21 or 0.21 -> 0.21."""
    if rate is None:
        return None
    return rate / Decimal(100) if rate > 1 else rate


def _evaluate_v3(
    invoice: InvoiceData,
    biz: BusinessData,
    erp_by_pedido: dict[str, ERPEntry],
    *,
    today: date | None = None,
    duplicate: bool = False,
) -> Outcome:
    """Decide one invoice. `duplicate` is injected by decide_batch when the same
    pedido appears on more than one invoice."""
    today = today or date.today()
    findings: list[Finding] = []
    evidence: dict = {}

    # --- gate: did extraction give us enough to judge? ---
    if not invoice.extraction_ok:
        findings.append(Finding("incomplete_extraction",
                                invoice.extraction_note or "extractor flagged low confidence"))
        return _aggregate(invoice, findings, evidence, "norma-v3")  # trust A's flag; don't guess
    required = {"purchase_order": invoice.purchase_order,
                "supplier_tax_id": invoice.supplier_tax_id,
                "total": invoice.total}
    missing = [k for k, v in required.items() if v in (None, "")]
    if missing:
        findings.append(Finding("incomplete_extraction", f"missing fields: {', '.join(missing)}"))
        return _aggregate(invoice, findings, evidence, "norma-v3")  # can't check anything else meaningfully

    # --- rule 1: supplier known + IBAN matches master ---
    supplier = biz.supplier_for_invoice(invoice.supplier_tax_id)
    if supplier is None:
        findings.append(Finding("supplier_not_in_master",
                                f"NIF {invoice.supplier_tax_id} not in supplier master"))
    else:
        evidence["supplier_id"] = supplier.id
        if normalize_iban(invoice.supplier_iban) != supplier.iban:
            findings.append(Finding("iban_mismatch",
                                    f"invoice IBAN != master IBAN for {supplier.id}"))

    # --- rule 2: pedido exists, belongs to supplier, amount matches ---
    order = biz.order(invoice.purchase_order)
    if order is None:
        findings.append(Finding("pedido_not_found", f"pedido {invoice.purchase_order} not in Pedidos_2026"))
    else:
        evidence["pedido"] = order.id
        belongs = (supplier is not None and order.supplier_id == supplier.id) or \
                  (order.tax_id and invoice.supplier_tax_id and order.tax_id == invoice.supplier_tax_id)
        if not belongs:
            findings.append(Finding("pedido_supplier_mismatch",
                                    f"pedido {order.id} belongs to {order.supplier_id}, not this supplier"))
        if not _approx(invoice.total, order.amount):
            findings.append(Finding("amount_mismatch",
                                    f"invoice total {invoice.total} != pedido {order.amount}"))

    # --- rule 3: IVA correct & total = base + IVA ---
    if invoice.base is not None and invoice.iva_amount is not None:
        if not _approx(invoice.total, invoice.base + invoice.iva_amount):
            findings.append(Finding("total_not_base_plus_iva",
                                    f"{invoice.base}+{invoice.iva_amount} != total {invoice.total}"))
        frac = _iva_rate_fraction(invoice.iva_rate)
        if frac is not None and not _approx(invoice.iva_amount, invoice.base * frac):
            findings.append(Finding("iva_miscalculated",
                                    f"IVA {invoice.iva_amount} != base*{frac}"))
    # if base/iva absent we don't fail rule 3 here — extraction gate covers unreadable docs

    # --- rule 4: valid, non-future date ---
    if invoice.issue_date is None:
        findings.append(Finding("invalid_date", "no valid issue date"))
    elif invoice.issue_date > today:
        findings.append(Finding("future_date", f"issue date {invoice.issue_date} is in the future"))

    # --- rule 5: ERP state PENDIENTE, never pay twice ---
    asiento = erp_by_pedido.get(invoice.purchase_order or "")
    if asiento is None:
        findings.append(Finding("pedido_not_in_erp", f"pedido {invoice.purchase_order} has no ERP asiento"))
    else:
        evidence["erp_asiento"] = asiento.asiento_id
        evidence["erp_status"] = asiento.status
        if not _approx(invoice.total, asiento.expected_amount):
            findings.append(Finding("erp_amount_mismatch",
                                    f"invoice total {invoice.total} != ERP {asiento.expected_amount}"))
        if asiento.status == "PAGADA":
            findings.append(Finding("already_paid", f"ERP asiento {asiento.asiento_id} already PAGADA"))
        elif asiento.status != "PENDIENTE":
            findings.append(Finding("erp_status_unexpected", f"ERP status {asiento.status}"))

    if duplicate:
        findings.append(Finding("duplicate_pedido",
                                f"pedido {invoice.purchase_order} appears on more than one invoice"))

    return _aggregate(invoice, findings, evidence, "norma-v3")


def _aggregate(
    invoice: InvoiceData,
    findings: list[Finding],
    evidence: dict,
    rules_version: str,
) -> Outcome:
    if not findings:
        return Outcome(file_id=invoice.file_id, result="PAGAR", reason="all_rules_pass",
                       detail=f"all {rules_version} checks passed", evidence=evidence,
                       rules_version=rules_version)
    # result = most severe finding (ESCALAR > NO_PAGAR)
    result = max((f.result for f in findings), key=lambda r: _PRECEDENCE[r])
    # primary reason = first finding whose result equals the chosen result
    primary = next(f for f in findings if f.result == result)
    return Outcome(
        file_id=invoice.file_id,
        result=result,
        reason=primary.code,
        detail="; ".join(f"{f.code}: {f.message}" for f in findings),
        findings=[f.code for f in findings],
        evidence=evidence,
        rules_version=rules_version,
    )


def evaluate(
    invoice: InvoiceData,
    biz: BusinessData,
    erp_by_pedido: dict[str, ERPEntry],
    *,
    today: date | None = None,
    duplicate: bool = False,
    rules_version: str = RULES_VERSION,
) -> Outcome:
    """Dispatch explicitly to a versioned evaluator; unknown versions fail closed."""
    evaluators = {
        "norma-v3": _evaluate_v3,
    }
    try:
        evaluator = evaluators[rules_version]
    except KeyError as exc:
        raise ValueError(
            f"rules engine {rules_version!r} is not implemented; "
            f"available: {', '.join(sorted(evaluators))}"
        ) from exc
    return evaluator(
        invoice,
        biz,
        erp_by_pedido,
        today=today,
        duplicate=duplicate,
    )


def decide_batch(
    invoices: list[InvoiceData],
    biz: BusinessData,
    erp_by_pedido: dict[str, ERPEntry],
    *,
    today: date | None = None,
    rules_version: str | None = None,
) -> list[Outcome]:
    """Decide a whole batch, handling cross-invoice duplicate-pedido detection
    (rule 5: never pay the same pedido twice)."""
    version = rules_version or biz.rules_version
    if version != biz.rules_version:
        raise ValueError(
            f"rules engine version {version!r} does not match business data "
            f"version {biz.rules_version!r}"
        )
    counts: dict[str, int] = {}
    for inv in invoices:
        if inv.purchase_order:
            counts[inv.purchase_order] = counts.get(inv.purchase_order, 0) + 1
    return [
        evaluate(inv, biz, erp_by_pedido, today=today,
                 duplicate=bool(inv.purchase_order and counts.get(inv.purchase_order, 0) > 1),
                 rules_version=version)
        for inv in invoices
    ]
