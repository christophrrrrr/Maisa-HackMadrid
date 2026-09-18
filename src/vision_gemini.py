"""Direct Google Gemini vision backend for the scanned invoices (free tier).

Kept dependency-light and import-free of invoice_extractor to avoid cycles: the
caller passes the prompt and validates the returned JSON against its own schema.
Uses the current `google-genai` SDK and Google AI Studio (GOOGLE_API_KEY), whose
Flash models are free for this volume.
"""
from __future__ import annotations

import os

from pydantic import BaseModel


def default_model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def gemini_available() -> str | None:
    """Return the API key if the free Gemini route is configured, else None."""
    return os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")


class GeminiInvoice(BaseModel):
    """Response schema forced on Gemini so it uses the EXACT canonical field names
    (all strings, nullable — the caller coerces to Decimal/date). Without this,
    the model invents keys like `total_amount`."""

    invoice_number: str | None = None
    purchase_order: str | None = None
    supplier_name: str | None = None
    supplier_tax_id: str | None = None
    supplier_iban: str | None = None
    issue_date: str | None = None   # YYYY-MM-DD
    base: str | None = None
    iva_amount: str | None = None
    iva_rate: str | None = None     # percentage number, e.g. "21"
    total: str | None = None


def call_gemini_json(images: list[bytes], prompt: str, *, model: str | None = None, api_key: str) -> str:
    """Send page images + prompt to Gemini and return raw JSON text matching the
    canonical field names. Uses OS trust store (Norton/corporate MITM safe),
    a forced response schema, and temperature 0 for determinism."""
    try:  # trust the OS cert store (handles Norton/corporate TLS interception)
        import truststore
        truststore.inject_into_ssl()
    except Exception:
        pass

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    parts: list = [types.Part.from_text(text=prompt)]
    for image in images:
        parts.append(types.Part.from_bytes(data=image, mime_type="image/png"))

    response = client.models.generate_content(
        model=model or default_model(),
        contents=parts,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=GeminiInvoice,
            temperature=0,
        ),
    )
    text = response.text
    if not text:
        raise ValueError("Gemini returned an empty response")
    return text
