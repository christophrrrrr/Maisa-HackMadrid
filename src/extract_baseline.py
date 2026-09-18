"""Baseline extractor — TEMPORARY / FALLBACK. Owner of the real one: Person A.

Deterministic multi-template regex over the digital-PDF text layer. It:
  * makes the pipeline + webapp runnable TODAY (before A's LLM extractor lands), and
  * serves as A's cheap deterministic FALLBACK when the LLM provider is down.

It deliberately does NOT handle scans/images (no text layer) — those return
extraction_ok=False so the rules engine escalates. A's extractor adds vision OCR.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import fitz  # PyMuPDF

from .models import InvoiceData

CLIENT_CIF = "A58231074"  # Banco Miralmar (the payer) — never the supplier
_MONTHS = {m: i + 1 for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"])}


def _num(s: str | None) -> Decimal | None:
    if not s:
        return None
    try:
        return Decimal(s.strip().replace(".", "").replace(",", "."))
    except Exception:
        return None


def _find(pats: list[str], t: str) -> str | None:
    for p in pats:
        m = re.search(p, t, re.I)
        if m:
            return m.group(1)
    return None


def _parse_date(t: str) -> date | None:
    try:
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", t)
        if m:
            return date(int(m[3]), int(m[2]), int(m[1]))
        m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", t, re.I)
        if m and m[2].lower() in _MONTHS:
            return date(int(m[3]), _MONTHS[m[2].lower()], int(m[1]))
    except ValueError:
        return None  # e.g. 31/02 -> invalid -> rules engine escalates
    return None


class BaselineExtractor:
    name = "baseline-regex"

    def extract(self, pdf_path: Path) -> InvoiceData:
        try:
            text = fitz.open(pdf_path)[0].get_text()
        except Exception as exc:  # unreadable file
            return InvoiceData(file_id=pdf_path.name, extraction_ok=False,
                               extraction_note=f"open failed: {exc}")

        if len(text.strip()) < 20:  # scan / image, no text layer
            return InvoiceData(file_id=pdf_path.name, extraction_ok=False,
                               extraction_note="no text layer (scan/image) — needs vision")

        nifs = [x for x in re.findall(r"\b([A-Z]\d{8}|\d{8}[A-Z])\b", text) if x != CLIENT_CIF]
        rate = _find([r"IVA\s*\((\d+)%\)"], text)
        inv = InvoiceData(
            file_id=pdf_path.name,
            invoice_number=_find([r"(?:N.?\s*de factura|REF FACTURA|Factura)[:\s]*([A-Z0-9/\-]+)"], text),
            purchase_order=_find([r"(PO-\d{4}-\d{3,4})"], text),
            supplier_tax_id=nifs[0] if nifs else None,
            supplier_iban=_find([r"IBAN\)?:?\s*([A-Z]{2}[0-9 ]{18,})", r"\b(ES\d{2}(?:\s?\d{4}){5})\b"], text),
            issue_date=_parse_date(text),
            base=_num(_find([r"(?:Base(?: imponible)?|BASE IMPONIBLE|Importe base)[.\s:]*([\d.,]+)"], text)),
            iva_amount=_num(_find([r"(?:Cuota IVA|IVA)\s*\(\d+%\)[.\s:]*([\d.,]+)"], text)),
            iva_rate=Decimal(rate) if rate else None,
            total=_num(_find([r"(?:TOTAL|Total factura|Total)[.\s:]*([\d.,]+)"], text)),
        )
        # if a core field is missing, flag low confidence so the engine escalates
        if not (inv.purchase_order and inv.supplier_tax_id and inv.total is not None):
            inv.extraction_ok = False
            inv.extraction_note = "baseline could not read all required fields"
        return inv
