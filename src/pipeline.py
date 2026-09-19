"""The batch pipeline — the actual product. Extract -> decide -> persist.

Walks the facturas, runs the (pluggable) extractor, applies the rules engine,
writes per-file decisions + the run summary to the state store, and emits
`outcomes.jsonl`. With `--stream` it prints one JSON line per file so the webapp
can show live progress, retries and latency over SSE.

This is what the "Run batch" button triggers:
    python -m src.pipeline --stream
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

from . import state
from .business_data import BusinessDataError, DEFAULT_XLSX, load_business_data
from .deliverables import validate_outcomes
from .erp_snapshot import (
    DEFAULT_DB as DEFAULT_ERP_DB,
    assert_snapshot_ready_for_batch,
    index_by_pedido,
    load_snapshot,
)
from .extractor import Extractor
from .manual_overrides import apply_override, load_overrides
from .models import InvoiceData
from .policy import accepted_suffixes, load_policy
from .rules_engine import decide_batch

def _default_workers() -> int:
    """How many invoices to extract concurrently. Extraction is I/O-bound (vision
    waits on the model), so a small pool overlaps those waits. Override with the
    MAISA_EXTRACT_WORKERS env var or the --workers flag. Lower it (e.g. 2-3) when
    using a rate-limited free model tier to avoid HTTP 429 bursts."""
    raw = os.getenv("MAISA_EXTRACT_WORKERS", "")
    try:
        value = int(raw)
        if value >= 1:
            return value
    except (TypeError, ValueError):
        pass
    return 8


DEFAULT_EXTRACT_WORKERS = _default_workers()

REPO = Path(__file__).resolve().parents[1]
FACTURAS_DIR = REPO / "challenge" / "facturas"
LOTE2_DIR = REPO / "lote_2_sorpresa" / "facturas"
LOTE2_SUPPLIERS_CSV = REPO / "lote_2_sorpresa" / "proveedores_nuevos.csv"
LOTE2_ORDERS_CSV = REPO / "lote_2_sorpresa" / "pedidos_nuevos.csv"
INBOX_DIR = REPO / "outputs" / "inbox"          # PDFs uploaded from the console
OUTCOMES = REPO / "outputs" / "outcomes.jsonl"
OUTCOMES_LOTE2 = REPO / "outputs" / "outcomes_lote2.jsonl"

BATCH_INPUT_DIRS = {
    "lote1": FACTURAS_DIR,
    "lote2": LOTE2_DIR,
}
BATCH_OUTCOMES = {
    "lote1": OUTCOMES,
    "lote2": OUTCOMES_LOTE2,
}
BATCH_RULES_VERSIONS = {
    "lote1": "norma-v3",
    "lote2": "norma-v4",
}
# Additive master data shipped as CSVs (new/foreign suppliers P012-P015 and the
# new purchase orders) that were never folded into the Excel. They describe the
# CURRENT supplier/order universe, so we merge them on EVERY run — including the
# ad-hoc uploads the console sends through outputs/inbox — not only `--batch
# lote2`. Only files that actually exist are loaded, so a checkout without the
# Saturday package stays clean, and the original 500 invoices never reference
# these ids so lote1 decisions are unchanged.
EXTRA_SUPPLIER_CSVS: list[Path] = [LOTE2_SUPPLIERS_CSV]
EXTRA_ORDER_CSVS: list[Path] = [LOTE2_ORDERS_CSV]


def _emit(stream: bool, obj: dict) -> None:
    """Progress line for the webapp (SSE) and/or human logs."""
    if stream:
        sys.stdout.write(json.dumps(obj, default=str) + "\n")
        sys.stdout.flush()


def get_extractor(name: str, *, use_vision: bool = True, force_vision: bool = False) -> Extractor:
    """Pick the extractor. 'hybrid' = A's digital+vision extractor (default);
    'baseline' = the deterministic regex fallback (offline, free)."""
    if name in ("hybrid", "llm", "auto"):
        from .extract_hybrid import HybridExtractor
        return HybridExtractor(use_vision=use_vision, force=force_vision)
    if name == "baseline":
        from .extract_baseline import BaselineExtractor
        return BaselineExtractor()
    raise SystemExit(f"unknown extractor '{name}' (available: hybrid, baseline)")


def _collect_files(
    facturas_dir: Path,
    limit: int | None,
    *,
    include_inbox: bool = True,
) -> list[Path]:
    suffixes = accepted_suffixes()

    def grab(folder: Path) -> list[Path]:
        if not folder.is_dir():
            return []
        return sorted(
            p for p in folder.iterdir()
            if p.is_file() and p.suffix.lower() in suffixes
        )

    files = grab(facturas_dir)
    # Also include anything uploaded from the console. Deduplicate by both name
    # and content because the upload boundary may normalize a Unicode filename.
    if include_inbox and INBOX_DIR.is_dir() and facturas_dir.resolve() != INBOX_DIR.resolve():
        def digest(file: Path) -> bytes:
            h = hashlib.sha256()
            with file.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(chunk)
            return h.digest()

        seen_names = {f.name for f in files}
        seen_content = {digest(f) for f in files}
        for file in grab(INBOX_DIR):
            content = digest(file)
            if file.name in seen_names or content in seen_content:
                continue
            files.append(file)
            seen_names.add(file.name)
            seen_content.add(content)
    return files[:limit] if limit else files


def input_dir_for_batch(batch: str) -> Path:
    try:
        return BATCH_INPUT_DIRS[batch]
    except KeyError as exc:
        raise ValueError(f"unknown batch {batch!r}") from exc


def outcomes_path_for_batch(batch: str) -> Path:
    try:
        return BATCH_OUTCOMES[batch]
    except KeyError as exc:
        raise ValueError(f"unknown batch {batch!r}") from exc


def rules_version_for_batch(batch: str) -> str:
    try:
        return BATCH_RULES_VERSIONS[batch]
    except KeyError as exc:
        raise ValueError(f"unknown batch {batch!r}") from exc


def extra_supplier_csvs_for_batch(batch: str) -> list[Path]:
    # batch kept for signature symmetry; the extra masters apply to every batch.
    return [path for path in EXTRA_SUPPLIER_CSVS if path.is_file()]


def extra_order_csvs_for_batch(batch: str) -> list[Path]:
    return [path for path in EXTRA_ORDER_CSVS if path.is_file()]


def write_outcomes(outcomes, path: Path) -> None:
    """Atomically write one batch contract without touching the other batch."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as fh:
        for outcome in outcomes:
            fh.write(json.dumps(outcome.to_contract_line(), ensure_ascii=False) + "\n")
    temporary.replace(path)


def run(
    *,
    facturas_dir: Path | None = None,
    extractor_name: str | None = None,
    batch: str = "lote1",
    batch_name: str | None = None,
    today: date | None = None,
    stream: bool = False,
    db_path: Path = state.DEFAULT_DB,
    limit: int | None = None,
    use_vision: bool = True,
    replace_state: bool = False,
    outcomes_path: Path | None = None,
    rules_version: str | None = None,
    xlsx_path: Path = DEFAULT_XLSX,
    erp_db_path: Path = DEFAULT_ERP_DB,
    extra_supplier_csvs: list[Path] | None = None,
    extra_order_csvs: list[Path] | None = None,
    max_workers: int | None = None,
    force_vision: bool = False,
) -> dict:
    # reference date + extractor fall back to the editable policy (settings page)
    cfg = load_policy()
    if today is None and cfg.get("today"):
        today = date.fromisoformat(cfg["today"])
    today = today or date.today()
    extractor = get_extractor(
        extractor_name or cfg.get("extractor") or "hybrid",
        use_vision=use_vision,
        force_vision=force_vision,
    )
    rules_version = rules_version or rules_version_for_batch(batch)
    supplier_csvs = (
        extra_supplier_csvs if extra_supplier_csvs is not None
        else extra_supplier_csvs_for_batch(batch)
    )
    order_csvs = (
        extra_order_csvs if extra_order_csvs is not None
        else extra_order_csvs_for_batch(batch)
    )
    try:
        biz = load_business_data(
            xlsx_path,
            rules_version=rules_version,
            extra_supplier_csvs=supplier_csvs,
            extra_order_csvs=order_csvs,
        )
    except BusinessDataError as exc:
        # the master Excel is structurally unreadable (a required sheet/column is
        # missing or renamed beyond recognition). fail loudly with an actionable
        # message instead of deciding on wrong / empty lookups.
        _emit(stream, {"event": "data_error", "scope": "business_data", "error": str(exc)})
        raise
    # Console runs default to batch=lote1, but the Saturday CSVs still need the
    # updated ERP snapshot (new pedidos). Require actualizacion_cargada=SI
    # whenever those extras are in play, not only for an explicit --batch lote2.
    snapshot_batch = "lote2" if (batch == "lote2" or supplier_csvs or order_csvs) else batch
    assert_snapshot_ready_for_batch(snapshot_batch, erp_db_path)
    erp = index_by_pedido(load_snapshot(erp_db_path))

    facturas_dir = facturas_dir or input_dir_for_batch(batch)
    outcomes_path = outcomes_path or outcomes_path_for_batch(batch)
    # Console uploads already pass --dir outputs/inbox. Do not silently merge a
    # leftover inbox into an official lote1 run — that would pollute outcomes.jsonl.
    files = _collect_files(facturas_dir, limit, include_inbox=False)
    if not files:
        raise RuntimeError(f"no supported invoice files found in {facturas_dir}")
    manual_overrides = load_overrides()
    run_id = datetime.now(timezone.utc).isoformat()
    batch_id = batch_name or batch

    conn = state.connect(db_path)
    state.start_run(conn, run_id, batch_id, biz.rules_version)
    _emit(stream, {"event": "run_start", "run_id": run_id, "total": len(files),
                   "extractor": extractor.name, "rules_version": biz.rules_version})
    # surface master data-quality issues (dup suppliers, conflicting rows, bad
    # amounts, NIF -> multiple ids). these don't stop the run but must be visible.
    if biz.warnings:
        _emit(stream, {"event": "data_warnings", "scope": "business_data", "warnings": biz.warnings})

    # 1) extract (the slow, probabilistic part) — measure per file.
    # Extraction is I/O-bound (vision calls wait on the model), so we fan the
    # files out across a thread pool. Each worker uses its OWN extractor instance
    # (thread-local), so the per-file method/cost/evidence it reads right after
    # extract() never races with another worker's extraction.
    latencies: dict[str, float] = {}
    method: dict[str, str] = {}
    costs: dict[str, float] = {}
    manual_override_count = 0
    extraction_evidence: dict[str, dict] = {}
    invoices_by_index: dict[int, InvoiceData] = {}

    extractor_kind = extractor_name or cfg.get("extractor") or "hybrid"
    worker_local = threading.local()

    def _worker_extractor() -> Extractor:
        existing = getattr(worker_local, "extractor", None)
        if existing is None:
            existing = get_extractor(
                extractor_kind, use_vision=use_vision, force_vision=force_vision,
            )
            worker_local.extractor = existing
        return existing

    def _extract_one(index: int, path: Path) -> dict:
        ex = _worker_extractor()
        started = time.monotonic()
        inv = ex.extract(path)
        taken = getattr(ex, "last_method", None) or (
            ex.name if inv.extraction_ok else f"{ex.name}(low-conf)")
        cost = float(getattr(ex, "last_cost", 0.0) or 0.0)
        evidence = dict(getattr(ex, "last_evidence", {}) or {})
        override_error: str | None = None
        try:
            inv, corrected = apply_override(inv, path, manual_overrides)
        except ValueError as override_err:
            # a stale or malformed manual override must never kill the whole
            # batch; skip it, keep the auto-extracted invoice, and surface it.
            corrected = False
            override_error = str(override_err)
        return {
            "index": index, "invoice": inv, "method": taken, "cost": cost,
            "evidence": evidence, "latency_ms": (time.monotonic() - started) * 1000,
            "corrected": corrected, "override_error": override_error,
        }

    workers = max(1, min(max_workers or DEFAULT_EXTRACT_WORKERS, len(files)))
    t0 = time.monotonic()
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_extract_one, i, f) for i, f in enumerate(files)]
        for future in as_completed(futures):
            res = future.result()
            done += 1
            inv = res["invoice"]
            invoices_by_index[res["index"]] = inv
            latencies[inv.file_id] = res["latency_ms"]
            taken = res["method"]
            if res["corrected"]:
                taken = f"{taken}+human-override"
                manual_override_count += 1
            method[inv.file_id] = taken
            costs[inv.file_id] = res["cost"]
            extraction_evidence[inv.file_id] = res["evidence"]
            if res["override_error"]:
                _emit(stream, {"event": "override_skipped",
                               "file_id": inv.file_id, "error": res["override_error"]})
            _emit(stream, {"event": "extracted", "i": done, "total": len(files),
                           "file_id": inv.file_id, "ok": inv.extraction_ok,
                           "latency_ms": round(res["latency_ms"], 1)})

    # preserve original file order for stable, reproducible outcomes
    invoices: list[InvoiceData] = [invoices_by_index[i] for i in range(len(files))]

    # 2) decide (deterministic, cheap) — needs the whole batch for duplicate detection
    previous_purchase_orders = state.purchase_orders_from_other_batches(
        batch_id, db_path, exclude_file_ids={file.name for file in files},
    )
    outcomes = decide_batch(
        invoices,
        biz,
        erp,
        today=today,
        rules_version=rules_version,
        existing_purchase_orders=previous_purchase_orders,
    )

    # 3) persist + emit each decision
    if replace_state:
        state.retain_decisions(conn, (o.file_id for o in outcomes))
    by_id = {inv.file_id: inv for inv in invoices}
    for o in outcomes:
        inv = by_id.get(o.file_id)
        state.record_decision(
            conn, run_id, o,
            extraction_method=method.get(o.file_id),
            extraction_ok=bool(inv.extraction_ok) if inv is not None else (o.reason == "all_rules_pass"),
            extracted=inv.model_dump() if inv is not None else None,
            extraction_evidence=extraction_evidence.get(o.file_id),
            latency_ms=latencies.get(o.file_id),
            cost_usd=costs.get(o.file_id, 0.0),
        )
        _emit(stream, {"event": "decided", "file_id": o.file_id, "result": o.result, "reason": o.reason})
    conn.commit()

    elapsed = time.monotonic() - t0
    total_cost = round(sum(costs.values()), 6)
    n_vision = sum(1 for v in method.values() if v == "vision")
    stats = {
        "extractor": extractor.name,
        "extractor_low_conf": sum(1 for v in method.values() if "low-conf" in v or v == "unavailable"),
        "avg_latency_ms": round(sum(latencies.values()) / len(latencies), 1) if latencies else 0,
        "n_vision": n_vision,
        "n_manual_overrides": manual_override_count,
        "prior_purchase_orders_checked": len(previous_purchase_orders),
        "cost_usd": total_cost,
        "data_warnings": biz.warnings,
    }
    state.finish_run(conn, run_id, elapsed_s=elapsed, cost_usd=total_cost, stats=stats)

    # 4) deliverable
    write_outcomes(outcomes, outcomes_path)
    contract = validate_outcomes(outcomes_path, (file.name for file in files))

    summary = state.snapshot(db_path)["summary"]
    _emit(stream, {"event": "run_done", "run_id": run_id, "elapsed_s": round(elapsed, 2),
                   "files_per_s": round(len(files) / elapsed, 1) if elapsed else 0, "summary": summary})
    conn.close()
    return {"run_id": run_id, "elapsed_s": elapsed, "summary": summary,
            "outcomes": str(outcomes_path), "contract": contract}


def _main() -> int:
    ap = argparse.ArgumentParser(description="Run the invoice-decision batch pipeline.")
    ap.add_argument("--extractor", default=None, help="hybrid (default) | baseline; overrides policy")
    ap.add_argument("--dir", help="directory of invoice PDFs (default: challenge/facturas)")
    ap.add_argument("--batch", default="lote1", choices=["lote1", "lote2"])
    ap.add_argument("--batch-name", help="unique identity for this logical batch")
    ap.add_argument("--out", help="output JSONL path (default: batch-specific artifact)")
    ap.add_argument("--rules-version", help="rules profile (default: norma-v3 / norma-v4 by batch)")
    ap.add_argument("--xlsx", default=str(DEFAULT_XLSX), help="business-data workbook")
    ap.add_argument("--erp-db", default=str(DEFAULT_ERP_DB), help="ERP snapshot SQLite path")
    ap.add_argument(
        "--extra-suppliers", action="append", dest="extra_suppliers",
        help="CSV of additional suppliers merged onto the master (repeatable); "
             "overrides the batch default when given",
    )
    ap.add_argument(
        "--extra-orders", action="append", dest="extra_orders",
        help="CSV of additional purchase orders merged onto the master (repeatable); "
             "overrides the batch default when given",
    )
    ap.add_argument("--stream", action="store_true", help="emit JSON progress lines (for the webapp SSE)")
    ap.add_argument("--today", help="reference date YYYY-MM-DD for rule 4 (default: today)")
    ap.add_argument("--limit", type=int, help="process only the first N files (dev)")
    ap.add_argument(
        "--workers", type=int, default=None,
        help=f"parallel extraction workers (default {DEFAULT_EXTRACT_WORKERS}; "
             "lower to ~2-3 for rate-limited free model tiers)",
    )
    ap.add_argument("--no-vision", action="store_true", help="skip the vision model for scans (digital only)")
    ap.add_argument(
        "--force", action="store_true",
        help="ignore the on-disk vision cache and call the model again (realistic timing)",
    )
    ap.add_argument(
        "--replace-state", action="store_true",
        help="replace the visible decisions with this batch after successful extraction",
    )
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else None
    facturas_dir = Path(args.dir) if args.dir else input_dir_for_batch(args.batch)
    outcomes_path = Path(args.out) if args.out else outcomes_path_for_batch(args.batch)
    extra_supplier_csvs = [Path(p) for p in args.extra_suppliers] if args.extra_suppliers else None
    extra_order_csvs = [Path(p) for p in args.extra_orders] if args.extra_orders else None
    result = run(facturas_dir=facturas_dir, extractor_name=args.extractor, batch=args.batch,
                 batch_name=args.batch_name,
                 stream=args.stream, today=today, limit=args.limit, use_vision=not args.no_vision,
                 replace_state=args.replace_state, outcomes_path=outcomes_path,
                 rules_version=args.rules_version, xlsx_path=Path(args.xlsx),
                 erp_db_path=Path(args.erp_db),
                 extra_supplier_csvs=extra_supplier_csvs, extra_order_csvs=extra_order_csvs,
                 max_workers=args.workers, force_vision=args.force)
    if not args.stream:
        print(f"run {result['run_id']}: {result['summary']} in {result['elapsed_s']:.2f}s -> {result['outcomes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
