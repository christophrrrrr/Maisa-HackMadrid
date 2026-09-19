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
from .policy import kind_for_suffix, load_policy


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
        self.last_cost: float = 0.0

    def extract(self, pdf_path: Path) -> InvoiceData:
        kind = kind_for_suffix(pdf_path.suffix)
        spec = (load_policy().get("file_types") or {}).get(kind or "pdf") or {}
        if kind == "xml":
            from .extract_xml import extract_xml
            inv = extract_xml(pdf_path, facturae=bool(spec.get("facturae", True)))
            self.last_method = "xml" if inv.extraction_ok else "xml-incomplete"
            self.last_cost = 0.0
            return inv
        # universal ingestion: any non-pdf/image/xml file (or an unknown suffix)
        # is normalised -> deterministic parse -> generic LLM -> triaged ESCALAR.
        if kind in ("email", "docx", "spreadsheet", "text") or kind is None:
            from .extract_docs import extract_document
            inv, method, cost = extract_document(
                pdf_path,
                use_vision=self.use_vision and bool(spec.get("vision", True)),
                model=self.model,
                fallback_models=self.fallback_models,
            )
            self.last_method = method
            self.last_cost = cost
            return inv
        use_vision = self.use_vision and bool(spec.get("vision", True))
        if kind == "image" and not use_vision:
            self.last_method = "unavailable"
            self.last_cost = 0.0
            return InvoiceData(
                file_id=pdf_path.name, extraction_ok=False,
                extraction_note="imagen sin vision",
            )
        try:
            record = ax.extract_pdf(
                pdf_path,
                use_vision=use_vision,
                model=self.model,
                fallback_models=self.fallback_models,
            )
            self.last_method = record.method
            self.last_cost = float(getattr(record, "cost_usd", 0.0) or 0.0)
            return record.invoice
        except Exception as exc:  # provider/library failure -> degrade, don't die
            if not self.baseline_on_error:
                raise
            self.last_method = "baseline-fallback"
            self.last_cost = 0.0
            inv = self._baseline.extract(pdf_path)
            inv.extraction_note = f"hybrid failed ({exc}); used baseline"
            return inv
