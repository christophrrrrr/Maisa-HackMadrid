"""minimal xml invoice reader (facturae / ubl / generic tags)."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .models import InvoiceData

CLIENT_CIF = "A58231074"

_NUM_TAGS = {
    "invoicenumber": "invoice_number",
    "invoicenumbercode": "invoice_number",
    "invoiceid": "invoice_number",
    "purchaseorder": "purchase_order",
    "purchaseordernumber": "purchase_order",
    "orderreference": "purchase_order",
    "pedido": "purchase_order",
    "iban": "supplier_iban",
    "taxidentificationnumber": "supplier_tax_id",
    "companyid": "supplier_tax_id",
    "partyidentification": "supplier_tax_id",
    "totalpayable": "total",
    "invoicetotal": "total",
    "payableamount": "total",
    "totalgrossamount": "base",
    "taxexclusiveamount": "base",
    "taxamount": "iva_amount",
    "totaltaxtoutputs": "iva_amount",
    "issuedate": "issue_date",
    "invoicedate": "issue_date",
}

_PO_RE = re.compile(r"(PO-\d{4}-\d{3,4})", re.I)
_NIF_RE = re.compile(r"\b([A-Z]\d{8}|\d{8}[A-Z])\b")
_IBAN_RE = re.compile(r"\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b")


def _local(tag: str) -> str:
    return tag.split("}")[-1].lower()


def _dec(s: str | None) -> Decimal | None:
    if not s:
        return None
    t = s.strip().replace(" ", "")
    if t.count(",") == 1 and t.count(".") == 0:
        t = t.replace(",", ".")
    elif t.count(",") == 1 and t.count(".") >= 1:
        t = t.replace(".", "").replace(",", ".")
    try:
        return Decimal(t)
    except (InvalidOperation, ValueError):
        return None


def _date(s: str | None) -> date | None:
    if not s:
        return None
    t = s.strip()[:10]
    for fmt, parts in (
        (r"^(\d{4})-(\d{2})-(\d{2})$", (0, 1, 2)),
        (r"^(\d{2})/(\d{2})/(\d{4})$", (2, 1, 0)),
    ):
        m = re.match(fmt, t)
        if not m:
            continue
        g = m.groups()
        try:
            y, mo, d = int(g[parts[0]]), int(g[parts[1]]), int(g[parts[2]])
            return date(y, mo, d)
        except ValueError:
            return None
    return None


def extract_xml(path: Path, *, facturae: bool = True) -> InvoiceData:
    try:
        root = ET.parse(path).getroot()
    except Exception as exc:
        return InvoiceData(
            file_id=path.name, extraction_ok=False,
            extraction_note=f"xml invalido: {exc}",
        )

    bag: dict[str, str] = {}
    blob: list[str] = []
    for el in root.iter():
        text = (el.text or "").strip()
        if not text:
            continue
        blob.append(text)
        field = _NUM_TAGS.get(_local(el.tag))
        if field and field not in bag:
            bag[field] = text

    joined = " ".join(blob)
    if "purchase_order" not in bag:
        m = _PO_RE.search(joined)
        if m:
            bag["purchase_order"] = m.group(1)
    if "supplier_iban" not in bag:
        m = _IBAN_RE.search(joined.replace(" ", ""))
        if m:
            bag["supplier_iban"] = m.group(1)
    if "supplier_tax_id" not in bag:
        nifs = [x for x in _NIF_RE.findall(joined) if x != CLIENT_CIF]
        if nifs:
            bag["supplier_tax_id"] = nifs[0]
    if "invoice_number" not in bag:
        # ubl invoice id is often just <id> on the root invoice
        for el in list(root)[:8]:
            if _local(el.tag) == "id" and (el.text or "").strip():
                bag["invoice_number"] = el.text.strip()
                break

    if not facturae and not bag:
        return InvoiceData(
            file_id=path.name, extraction_ok=False,
            extraction_note="xml sin mapeo facturae/ubl",
        )

    inv = InvoiceData(
        file_id=path.name,
        invoice_number=bag.get("invoice_number"),
        purchase_order=bag.get("purchase_order"),
        supplier_tax_id=bag.get("supplier_tax_id"),
        supplier_iban=bag.get("supplier_iban"),
        issue_date=_date(bag.get("issue_date")),
        base=_dec(bag.get("base")),
        iva_amount=_dec(bag.get("iva_amount")),
        total=_dec(bag.get("total")),
        extraction_ok=True,
    )
    missing = [k for k in ("purchase_order", "supplier_tax_id", "total") if getattr(inv, k) in (None, "")]
    if missing:
        inv.extraction_ok = False
        inv.extraction_note = "xml incompleto: " + ", ".join(missing)
    return inv
