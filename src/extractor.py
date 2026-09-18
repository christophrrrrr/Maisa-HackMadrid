"""Extractor interface (the seam between Person A and the pipeline).

Person A's real extractor (LLM/vision for scans + robust multi-template parsing)
must implement this Protocol. The pipeline is written against the interface, so
swapping A's extractor in — or falling back to the baseline when the LLM is down
— is a one-line change. That fallback IS the resilience story.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from .models import InvoiceData


@runtime_checkable
class Extractor(Protocol):
    name: str

    def extract(self, pdf_path: Path) -> InvoiceData:
        """Turn one invoice PDF into canonical InvoiceData.

        Must ALWAYS return an InvoiceData (never raise). If the document can't be
        read confidently, set `extraction_ok=False` + `extraction_note` so the
        rules engine escalates instead of guessing.
        """
        ...


class AutoExtractor:
    """baseline for digital PDFs; vision/LLM only when there is no usable text layer."""

    name = "auto"

    def __init__(self) -> None:
        from .extract_baseline import BaselineExtractor
        self._baseline = BaselineExtractor()
        self._vision = None
        try:
            from .extract_llm import LLMExtractor  # type: ignore
            self._vision = LLMExtractor()
        except Exception:
            self._vision = None

    def extract(self, pdf_path: Path) -> InvoiceData:
        inv = self._baseline.extract(pdf_path)
        if inv.extraction_ok or self._vision is None:
            return inv
        return self._vision.extract(pdf_path)
