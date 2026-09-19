"""Hybrid invoice extractor for the challenge PDFs.

Digital PDFs are parsed locally with PyMuPDF + deterministic patterns. Image-only
PDFs are rendered to PNG and sent through Vercel AI Gateway with a strict JSON
schema. The vision result is cached by content hash so retries and re-runs are free.

Run the whole batch:

    python -m src.invoice_extractor

Scans require AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN). Without it the command still emits all 500 records,
marking image-only PDFs as ``extraction_ok=false`` so the rules engine escalates.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal

import pymupdf as fitz
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from .models import InvoiceData


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
DEFAULT_INPUT = ROOT / "challenge" / "facturas"
DEFAULT_OUTPUT = ROOT / "outputs" / "extracted_invoices.jsonl"
DEFAULT_CACHE = ROOT / ".cache" / "invoice_extraction"
GATEWAY_BASE_URL = os.getenv("AI_GATEWAY_BASE_URL", "https://ai-gateway.vercel.sh/v1")
DEFAULT_MODEL = os.getenv("AI_GATEWAY_MODEL", "google/gemini-2.5-flash")
DEFAULT_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv(
        "AI_GATEWAY_FALLBACK_MODELS",
        "anthropic/claude-sonnet-4-5,openai/gpt-4o",
    ).split(",")
    if model.strip()
]
MIN_TEXT_CHARS = 100
MONEY_TOLERANCE = Decimal("0.01")
# last paid vision call (gateway). digital / cache / free Gemini stay 0.
_last_vision_cost = 0.0

ExtractionMethod = Literal["embedded_text", "vision", "vision_cache", "unavailable"]


class Evidence(BaseModel):
    page: int
    text: str


class ExtractionRecord(BaseModel):
    invoice: InvoiceData
    method: ExtractionMethod
    template: str | None = None
    sha256: str
    text_chars: int
    evidence: dict[str, Evidence] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    latency_ms: int = 0
    model: str | None = None
    cost_usd: float = 0.0


class VisionInvoice(BaseModel):
    """Exact schema requested from the vision model.

    Dates must be ISO and amounts must use a dot decimal separator; Pydantic then
    converts them to the canonical types used by the rules engine.
    """

    invoice_number: str | None
    purchase_order: str | None
    supplier_name: str | None
    supplier_tax_id: str | None
    supplier_iban: str | None
    issue_date: date | None
    base: Decimal | None
    iva_amount: Decimal | None
    iva_rate: Decimal | None
    total: Decimal | None


_MONTHS = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}


def _normalise_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return text.replace("\u200b", "").replace("\ufeff", "").replace("\xa0", " ")


def _compact_chars(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def _first_group(text: str, patterns: list[str]) -> tuple[str | None, str | None]:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            value = match.group(1).strip()
            line_start = text.rfind("\n", 0, match.start()) + 1
            line_end = text.find("\n", match.end())
            if line_end < 0:
                line_end = len(text)
            evidence = re.sub(r"\s+", " ", text[line_start:line_end]).strip()
            return value, evidence
    return None, None


def _parse_decimal(raw: str | None) -> Decimal | None:
    if raw is None:
        return None
    value = re.sub(r"[^0-9,.-]", "", raw.strip())
    if not value:
        return None
    if "," in value and "." in value:
        if value.rfind(",") > value.rfind("."):
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")
    elif "," in value:
        value = value.replace(".", "").replace(",", ".")
    elif value.count(".") > 1:
        parts = value.split(".")
        value = "".join(parts[:-1]) + "." + parts[-1]
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def _parse_date(text: str) -> tuple[date | None, str | None]:
    raw, evidence = _first_group(
        text,
        [
            r"\bFecha(?:\s+factura|\s+de\s+emisi[oó]n)?\s*:\s*(\d{1,2}/\d{1,2}/\d{4})",
            r"\bFECHA\s*:\s*(\d{1,2}/\d{1,2}/\d{4})",
        ],
    )
    if raw:
        try:
            day, month, year = map(int, raw.split("/"))
            return date(year, month, day), evidence
        except ValueError:
            return None, evidence

    match = re.search(
        r"^\s*Fecha\s+de\s+emisi[oó]n\s*:\s*(\d{1,2})\s+de\s+"
        r"([a-záéíóú]+)\s+de\s+(\d{4})",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    if not match:
        return None, None
    month_name = unicodedata.normalize("NFKD", match.group(2).lower())
    month_name = "".join(c for c in month_name if not unicodedata.combining(c))
    month = _MONTHS.get(month_name)
    if not month:
        return None, match.group(0).strip()
    return date(int(match.group(3)), month, int(match.group(1))), match.group(0).strip()


def _template(text: str) -> str:
    markers = [
        ("simplified", r"FACTURA SIMPLIFICADA"),
        ("ref_uppercase", r"REF FACTURA"),
        ("narrative", r"N[ºo]\s+de factura"),
        ("modern", r"FACTURA N[ºo]\s*:"),
        ("invoice_en", r"Invoice\s*#"),
    ]
    for name, marker in markers:
        if re.search(marker, text, re.IGNORECASE):
            return name
    return "standard"


def _page_for_evidence(page_texts: list[str], snippet: str) -> int:
    needle = re.sub(r"\s+", " ", snippet).strip().casefold()
    for index, page_text in enumerate(page_texts, start=1):
        haystack = re.sub(r"\s+", " ", page_text).casefold()
        if needle and needle in haystack:
            return index
    return 1


def _parse_digital(file_id: str, page_texts: list[str]) -> tuple[InvoiceData, str, dict[str, Evidence], list[str]]:
    text = _normalise_text("\n".join(page_texts))
    template = _template(text)
    evidence_lines: dict[str, str] = {}

    def field(name: str, patterns: list[str]) -> str | None:
        value, evidence = _first_group(text, patterns)
        if evidence:
            evidence_lines[name] = evidence
        return value

    invoice_number = field(
        "invoice_number",
        [
            r"^\s*Factura\s*:\s*([^\s]+)",
            r"^\s*REF FACTURA\s*:\s*([^\s]+)",
            r"^\s*N[ºo]\s+de factura\s*:\s*([^\s]+)",
            r"FACTURA SIMPLIFICADA N[ºo]\s*([^\s]+)",
            r"^\s*FACTURA N[ºo]\s*:\s*([^\s]+)",
            r"^\s*Invoice\s*#\s*([^\s]+)",
        ],
    )
    purchase_order = field(
        "purchase_order",
        [
            r"^\s*Pedido\s*:\s*(PO-[A-Z0-9-]+)",
            r"^\s*PEDIDO CLIENTE\s*:\s*(PO-[A-Z0-9-]+)",
            r"^\s*Su pedido\s*:\s*(PO-[A-Z0-9-]+)",
            r"Pedido asociado\s*:\s*(PO-[A-Z0-9-]+)",
            r"\bRef\.\s*Pedido\s*:\s*(PO-[A-Z0-9-]+)",
            r"\bPO\s*:\s*(PO-[A-Z0-9-]+)",
        ],
    )
    supplier_tax_id = field("supplier_tax_id", [r"\bNIF\s*:?\s*([A-Z]\d{8})\b"])
    iban_raw = field("supplier_iban", [r"\b(ES(?:\s*\d){22})\b"])
    supplier_iban = re.sub(r"\s+", "", iban_raw).upper() if iban_raw else None
    supplier_name = field(
        "supplier_name",
        [
            r"^\s*Emisor\s*:\s*(.+?(?:S\.?L\.?|S\.?A\.?|S\.?C\.?))(?=\s*[·|]|\s*$)",
            r"^(?!.*(?:Cliente|Banco Miralmar|Bill to|Destinatario|Facturar a))\s*"
            r"(.+?(?:S\.?L\.?|S\.?A\.?|S\.?C\.?))(?=\s*(?:[·|]|$))",
        ],
    )

    issue_date, date_evidence = _parse_date(text)
    if date_evidence:
        evidence_lines["issue_date"] = date_evidence

    base_raw = field(
        "base",
        [r"^\s*(?:Base|BASE IMPONIBLE|Importe base|Base imponible|Subtotal)\s*"
         r"(?::|\.{2,})\s*(?:EUR\s*)?([0-9][0-9.,]*)"],
    )
    iva_match = re.search(
        r"^\s*(?:IVA|I\.V\.A\.|Cuota IVA)\s*\(\s*([0-9.,]+)\s*%\s*\)\s*"
        r"(?::|\.{2,})\s*(?:EUR\s*)?([0-9][0-9.,]*)",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    iva_rate = _parse_decimal(iva_match.group(1)) if iva_match else None
    iva_amount = _parse_decimal(iva_match.group(2)) if iva_match else None
    if iva_match:
        line_end = text.find("\n", iva_match.end())
        evidence_lines["iva_amount"] = text[iva_match.start():line_end if line_end >= 0 else len(text)].strip()
        evidence_lines["iva_rate"] = evidence_lines["iva_amount"]

    total_raw = field(
        "total",
        [r"^\s*(?:TOTAL A PAGAR|IMPORTE TOTAL|Total factura|TOTAL)\s*"
         r"(?::|\.{2,})\s*(?:EUR\s*)?([0-9][0-9.,]*)"],
    )

    values: dict[str, Any] = {
        "invoice_number": invoice_number,
        "purchase_order": purchase_order,
        "supplier_name": supplier_name,
        "supplier_tax_id": supplier_tax_id,
        "supplier_iban": supplier_iban,
        "issue_date": issue_date,
        "base": _parse_decimal(base_raw),
        "iva_amount": iva_amount,
        "iva_rate": iva_rate,
        "total": _parse_decimal(total_raw),
    }
    required = ["purchase_order", "supplier_tax_id", "supplier_iban", "base", "iva_amount", "total"]
    missing = [name for name in required if values[name] is None]
    warnings = [f"missing field: {name}" for name in missing]
    if issue_date is None:
        if date_evidence:
            warnings.append("invalid issue date")
        else:
            missing.append("issue_date")
            warnings.append("missing field: issue_date")

    invoice = InvoiceData(
        file_id=file_id,
        **values,
        extraction_ok=not missing,
        extraction_note="; ".join(warnings) or None,
    )
    evidence = {
        name: Evidence(page=_page_for_evidence(page_texts, line), text=line)
        for name, line in evidence_lines.items()
    }
    return invoice, template, evidence, warnings


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _render_one_page(page: "fitz.Page", dpi: int) -> bytes:
    """Rasterise a single page to PNG bytes, freeing the pixmap immediately and
    retrying at progressively lower DPI if the allocation fails.

    High-DPI pixmaps need a large contiguous buffer; under memory pressure (or a
    32-bit interpreter) PyMuPDF raises `code=2: malloc (...) failed`. Rather than
    let the whole page — and therefore the invoice — degrade to an unreadable
    scan, we step the resolution down and try again. Lower DPI is still perfectly
    legible to the vision model."""
    last_error: Exception | None = None
    for attempt_dpi in (dpi, 150, 110, 90):
        pix = None
        try:
            matrix = fitz.Matrix(attempt_dpi / 72, attempt_dpi / 72)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            data = pix.tobytes("png")
            return data
        except Exception as exc:  # memory / rendering failure -> smaller buffer
            last_error = exc
        finally:
            pix = None  # release the C-side buffer before the next attempt
    raise RuntimeError(f"could not rasterise page even at reduced DPI: {last_error}")


def _render_pages(document: fitz.Document, dpi: int = 200) -> list[bytes]:
    return [_render_one_page(page, dpi) for page in document]


def _vision_prompt() -> str:
    return (
        "Extract the supplier invoice fields from these page images. The payer/customer is Banco "
        "Miralmar; do not confuse its CIF with the supplier NIF. Copy values from the document and "
        "never infer missing values. Use null when unreadable. Return issue_date as YYYY-MM-DD, "
        "monetary values as decimal numbers without currency or thousands separators, iva_rate as "
        "the percentage number (for example 21), IBAN without spaces, and the purchase order exactly "
        "as printed (normally PO-2026-NNNN)."
    )


def _invoice_from_vision(file_id: str, parsed: VisionInvoice) -> tuple[InvoiceData, list[str]]:
    values = parsed.model_dump()
    required = ["purchase_order", "supplier_tax_id", "supplier_iban", "issue_date", "base", "iva_amount", "total"]
    missing = [name for name in required if values.get(name) is None]
    warnings = [f"missing field: {name}" for name in missing]
    if parsed.supplier_iban:
        values["supplier_iban"] = re.sub(r"\s+", "", parsed.supplier_iban).upper()
    return InvoiceData(
        file_id=file_id,
        **values,
        extraction_ok=not missing,
        extraction_note="; ".join(warnings) or None,
    ), warnings


def _usd_from_usage(model: str, usage: Any) -> float:
    """price a completion from token usage. digital / cache / free gemini never call this."""
    if usage is None:
        return 0.0
    if isinstance(usage, dict):
        inp = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
        out = usage.get("completion_tokens") or usage.get("output_tokens") or 0
    else:
        inp = getattr(usage, "prompt_tokens", None) or getattr(usage, "input_tokens", None) or 0
        out = getattr(usage, "completion_tokens", None) or getattr(usage, "output_tokens", None) or 0
    inp, out = int(inp), int(out)
    m = (model or "").lower()
    # USD per 1M tokens — list prices, not guesses from the UI
    pin, pout = 0.15, 0.60  # gemini 2.5 flash
    if "gpt-4o" in m:
        pin, pout = 2.50, 10.00
    elif "claude" in m:
        pin, pout = 3.00, 15.00
    return (inp * pin + out * pout) / 1_000_000


def _call_gateway_vision(
    images: list[bytes], model: str, fallback_models: list[str], gateway_key: str
) -> VisionInvoice:
    """Vercel AI Gateway path (OpenAI-compatible), used when no GOOGLE_API_KEY is set."""
    from openai import OpenAI

    content: list[dict[str, Any]] = [{"type": "text", "text": _vision_prompt()}]
    for image in images:
        encoded = base64.b64encode(image).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encoded}", "detail": "high"},
        })
    client = OpenAI(api_key=gateway_key, base_url=GATEWAY_BASE_URL)
    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": "invoice_extraction",
            "strict": True,
            "schema": VisionInvoice.model_json_schema(),
        },
    }
    extra_body = {"providerOptions": {"gateway": {"models": fallback_models}}} if fallback_models else None
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        response_format=response_format,
        extra_body=extra_body,
    )
    global _last_vision_cost
    _last_vision_cost = _usd_from_usage(model, getattr(response, "usage", None))
    response_text = response.choices[0].message.content
    if not response_text:
        raise ValueError("AI Gateway returned no response content")
    return VisionInvoice.model_validate_json(response_text)


def _extract_with_vision(
    path: Path,
    document: fitz.Document,
    *,
    digest: str,
    cache_dir: Path,
    model: str,
    fallback_models: list[str],
    force: bool,
) -> tuple[InvoiceData, ExtractionMethod, list[str]]:
    cache_path = cache_dir / f"{digest}.json"
    global _last_vision_cost
    _last_vision_cost = 0.0
    if cache_path.exists() and not force:
        cached = VisionInvoice.model_validate_json(cache_path.read_text(encoding="utf-8"))
        invoice, warnings = _invoice_from_vision(path.name, cached)
        return invoice, "vision_cache", warnings

    from . import vision_gemini as vg

    google_key = vg.gemini_available()
    gateway_key = os.getenv("AI_GATEWAY_API_KEY") or os.getenv("VERCEL_OIDC_TOKEN")
    if not google_key and not gateway_key:
        note = ("image-only PDF; set GOOGLE_API_KEY (free Gemini) or AI_GATEWAY_API_KEY "
                "in .env and rerun with --force")
        return InvoiceData(file_id=path.name, extraction_ok=False, extraction_note=note), "unavailable", [note]

    images = _render_pages(document)
    last_error: Exception | None = None
    parsed: VisionInvoice | None = None
    for attempt in range(3):
        try:
            if google_key:  # preferred: free direct Gemini
                text = vg.call_gemini_json(images, _vision_prompt(), api_key=google_key)
                parsed = VisionInvoice.model_validate_json(text)
            else:
                parsed = _call_gateway_vision(images, model, fallback_models, gateway_key)
            break
        except Exception as exc:  # provider errors are retried, then made explicit
            last_error = exc
            if attempt < 2:
                time.sleep(2**attempt)
    if parsed is None:
        note = f"vision extraction failed after 3 attempts: {last_error}"
        return InvoiceData(file_id=path.name, extraction_ok=False, extraction_note=note), "unavailable", [note]

    invoice, warnings = _invoice_from_vision(path.name, parsed)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(parsed.model_dump_json(indent=2), encoding="utf-8")
    return invoice, "vision", warnings


# canonical fields used to compare two reads of the same document (digital vs
# vision) so a vision re-pass is only adopted when it recovers at least as much.
_CANONICAL_FIELDS = (
    "purchase_order", "supplier_tax_id", "supplier_iban",
    "issue_date", "base", "iva_amount", "total",
)


def _completeness(invoice: InvoiceData) -> int:
    values = invoice.model_dump()
    return sum(1 for name in _CANONICAL_FIELDS if values.get(name) is not None)


def _add_arithmetic_warnings(invoice: InvoiceData, warnings: list[str]) -> None:
    if invoice.base is not None and invoice.iva_amount is not None and invoice.total is not None:
        if abs(invoice.base + invoice.iva_amount - invoice.total) > MONEY_TOLERANCE:
            warnings.append("total does not equal base + IVA")
    if invoice.base is not None and invoice.iva_amount is not None and invoice.iva_rate is not None:
        rate = invoice.iva_rate / 100 if invoice.iva_rate > 1 else invoice.iva_rate
        if abs(invoice.base * rate - invoice.iva_amount) > MONEY_TOLERANCE:
            warnings.append("IVA does not equal base * rate")


def extract_pdf(
    path: Path,
    *,
    use_vision: bool = True,
    cache_dir: Path = DEFAULT_CACHE,
    model: str = DEFAULT_MODEL,
    fallback_models: list[str] | None = None,
    force: bool = False,
) -> ExtractionRecord:
    started = time.perf_counter()
    global _last_vision_cost
    _last_vision_cost = 0.0
    digest = _sha256(path)
    document = fitz.open(path)
    try:
        page_texts = [_normalise_text(page.get_text("text", sort=True)) for page in document]
        text_chars = _compact_chars("".join(page_texts))
        if text_chars >= MIN_TEXT_CHARS:
            invoice, template, evidence, warnings = _parse_digital(path.name, page_texts)
            method: ExtractionMethod = "embedded_text"
            used_model = None
            # The page HAS a text layer, but the deterministic parser could not
            # read every required field — a new template, a foreign-language
            # layout (USt-ID / N° TVA), or an unusual date/amount format the
            # regex doesn't know. Rather than fail closed on the text path,
            # escalate to the format-agnostic vision model. This is what makes a
            # brand-new invoice format need NO code change: the LLM covers it.
            if not invoice.extraction_ok and use_vision:
                v_invoice, v_method, v_warnings = _extract_with_vision(
                    path,
                    document,
                    digest=digest,
                    cache_dir=cache_dir,
                    model=model,
                    fallback_models=DEFAULT_FALLBACK_MODELS if fallback_models is None else fallback_models,
                    force=force,
                )
                # Adopt vision only if it actually ran and did not regress: keep
                # whichever read recovered more canonical fields (or is complete).
                if v_method in {"vision", "vision_cache"} and (
                    v_invoice.extraction_ok
                    or _completeness(v_invoice) > _completeness(invoice)
                ):
                    invoice = v_invoice
                    method = v_method
                    template = None
                    evidence = {}
                    used_model = model if v_method in {"vision", "vision_cache"} else None
                    warnings = list(v_warnings) + [
                        "texto digital incompleto; reprocesado con visión"
                    ]
        elif use_vision:
            invoice, method, warnings = _extract_with_vision(
                path,
                document,
                digest=digest,
                cache_dir=cache_dir,
                model=model,
                fallback_models=DEFAULT_FALLBACK_MODELS if fallback_models is None else fallback_models,
                force=force,
            )
            template = None
            evidence = {}
            used_model = model if method in {"vision", "vision_cache"} else None
        else:
            note = "image-only PDF; vision disabled"
            invoice = InvoiceData(file_id=path.name, extraction_ok=False, extraction_note=note)
            method = "unavailable"
            template = None
            evidence = {}
            warnings = [note]
            used_model = None
        _add_arithmetic_warnings(invoice, warnings)
        return ExtractionRecord(
            invoice=invoice,
            method=method,
            template=template,
            sha256=digest,
            text_chars=text_chars,
            evidence=evidence,
            warnings=warnings,
            latency_ms=round((time.perf_counter() - started) * 1000),
            model=used_model,
            cost_usd=_last_vision_cost if method == "vision" else 0.0,
        )
    finally:
        document.close()


def extract_batch(
    input_path: Path,
    *,
    output_path: Path,
    use_vision: bool = True,
    cache_dir: Path = DEFAULT_CACHE,
    model: str = DEFAULT_MODEL,
    fallback_models: list[str] | None = None,
    force: bool = False,
) -> list[ExtractionRecord]:
    paths = [input_path] if input_path.is_file() else sorted(input_path.glob("*.pdf"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    records: list[ExtractionRecord] = []
    with output_path.open("w", encoding="utf-8") as stream:
        for index, path in enumerate(paths, start=1):
            record = extract_pdf(
                path,
                use_vision=use_vision,
                cache_dir=cache_dir,
                model=model,
                fallback_models=fallback_models,
                force=force,
            )
            records.append(record)
            stream.write(json.dumps(record.model_dump(mode="json"), ensure_ascii=False) + "\n")
            status = "ok" if record.invoice.extraction_ok else "needs-review"
            print(f"[{index:03d}/{len(paths):03d}] {path.name}: {record.method} {status}", file=sys.stderr)
    return records


def _summary(records: list[ExtractionRecord]) -> str:
    methods: dict[str, int] = {}
    templates: dict[str, int] = {}
    ok = 0
    for record in records:
        methods[record.method] = methods.get(record.method, 0) + 1
        if record.template:
            templates[record.template] = templates.get(record.template, 0) + 1
        ok += int(record.invoice.extraction_ok)
    return json.dumps(
        {"files": len(records), "ok": ok, "needs_review": len(records) - ok,
         "methods": methods, "templates": templates},
        ensure_ascii=False,
    )


def _main() -> int:
    parser = argparse.ArgumentParser(description="Extract canonical invoice data from PDFs")
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Vercel AI Gateway model (provider/model)")
    parser.add_argument(
        "--fallback-model",
        action="append",
        dest="fallback_models",
        help="Gateway fallback model; repeat to set multiple. Defaults from AI_GATEWAY_FALLBACK_MODELS.",
    )
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--no-vision", action="store_true", help="Do not call the vision API")
    parser.add_argument("--force", action="store_true", help="Ignore cached vision results")
    args = parser.parse_args()

    records = extract_batch(
        args.input,
        output_path=args.output,
        use_vision=not args.no_vision,
        cache_dir=args.cache_dir,
        model=args.model,
        fallback_models=args.fallback_models,
        force=args.force,
    )
    print(_summary(records))
    return 0 if all(record.invoice.extraction_ok for record in records) else 2


if __name__ == "__main__":
    raise SystemExit(_main())
