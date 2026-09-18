"""Hybrid extractor adapter — wires Person A's extractor into the pipeline.

Person A built `invoice_extractor.py` (digital PDF parsing + vision fallback for
scans). This thin adapter makes it satisfy the pipeline's `Extractor` Protocol
(`extract(path) -> InvoiceData`) and adds a resilience net: if A's extractor
raises for any reason, we degrade to the deterministic baseline instead of
crashing the whole batch. That degrade-don't-die behaviour is the resilience story.

`last_method` exposes the per-file path actually taken (embedded_text / vision /
vision_cache / unavailable / baseline-fallback) so the pipeline can record it.
"""
from __future__ import annotations

from pathlib import Path

from . import invoice_extractor as ax
from .extract_baseline import BaselineExtractor
from .models import InvoiceData


class HybridExtractor:
    name = "hybrid"

    def __init__(
        self,
        *,
        use_vision: bool = True,
        model: str = ax.DEFAULT_MODEL,
        fallback_models: list[str] | None = None,
        baseline_on_error: bool = True,
    ) -> None:
        self.use_vision = use_vision
        self.model = model
        self.fallback_models = fallback_models
        self.baseline_on_error = baseline_on_error
        self._baseline = BaselineExtractor()
        self.last_method: str = "hybrid"

    def extract(self, pdf_path: Path) -> InvoiceData:
        try:
            record = ax.extract_pdf(
                pdf_path,
                use_vision=self.use_vision,
                model=self.model,
                fallback_models=self.fallback_models,
            )
            self.last_method = record.method
            return record.invoice
        except Exception as exc:  # provider/library failure -> degrade, don't die
            if not self.baseline_on_error:
                raise
            self.last_method = "baseline-fallback"
            inv = self._baseline.extract(pdf_path)
            inv.extraction_note = f"hybrid failed ({exc}); used baseline"
            return inv
