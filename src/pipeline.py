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
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from . import state
from .business_data import load_business_data
from .erp_snapshot import index_by_pedido, load_snapshot
from .extractor import Extractor
from .manual_overrides import apply_override, load_overrides
from .models import InvoiceData
from .policy import accepted_suffixes, load_policy
from .rules_engine import decide_batch

REPO = Path(__file__).resolve().parents[1]
FACTURAS_DIR = REPO / "challenge" / "facturas"
LOTE2_DIR = REPO / "lote_2_sorpresa" / "facturas"
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


def _emit(stream: bool, obj: dict) -> None:
    """Progress line for the webapp (SSE) and/or human logs."""
    if stream:
        sys.stdout.write(json.dumps(obj, default=str) + "\n")
        sys.stdout.flush()


def get_extractor(name: str, *, use_vision: bool = True) -> Extractor:
    """Pick the extractor. 'hybrid' = A's digital+vision extractor (default);
    'baseline' = the deterministic regex fallback (offline, free)."""
    if name in ("hybrid", "llm", "auto"):
        from .extract_hybrid import HybridExtractor
        return HybridExtractor(use_vision=use_vision)
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


def write_outcomes(outcomes, path: Path) -> None:
    """Write one batch contract without touching the other batch's artifact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for outcome in outcomes:
            fh.write(json.dumps(outcome.to_contract_line(), ensure_ascii=False) + "\n")


def run(
    *,
    facturas_dir: Path | None = None,
    extractor_name: str | None = None,
    batch: str = "lote1",
    today: date | None = None,
    stream: bool = False,
    db_path: Path = state.DEFAULT_DB,
    limit: int | None = None,
    use_vision: bool = True,
    replace_state: bool = False,
    outcomes_path: Path | None = None,
) -> dict:
    # reference date + extractor fall back to the editable policy (settings page)
    cfg = load_policy()
    if today is None and cfg.get("today"):
        today = date.fromisoformat(cfg["today"])
    today = today or date.today()
    extractor = get_extractor(extractor_name or cfg.get("extractor") or "hybrid", use_vision=use_vision)
    biz = load_business_data()
    erp = index_by_pedido(load_snapshot())

    facturas_dir = facturas_dir or input_dir_for_batch(batch)
    outcomes_path = outcomes_path or outcomes_path_for_batch(batch)
    files = _collect_files(facturas_dir, limit, include_inbox=(batch == "lote1"))
    if not files:
        raise RuntimeError(f"no supported invoice files found in {facturas_dir}")
    manual_overrides = load_overrides()
    run_id = datetime.now(timezone.utc).isoformat()

    conn = state.connect(db_path)
    state.start_run(conn, run_id, batch, biz.rules_version)
    _emit(stream, {"event": "run_start", "run_id": run_id, "total": len(files),
                   "extractor": extractor.name, "rules_version": biz.rules_version})

    # 1) extract (the slow, probabilistic part) — measure per file
    invoices: list[InvoiceData] = []
    latencies: dict[str, float] = {}
    method: dict[str, str] = {}
    costs: dict[str, float] = {}
    manual_override_count = 0
    t0 = time.monotonic()
    for i, f in enumerate(files, 1):
        s = time.monotonic()
        inv = extractor.extract(f)
        inv, manually_corrected = apply_override(inv, f, manual_overrides)
        ms = (time.monotonic() - s) * 1000
        invoices.append(inv)
        latencies[inv.file_id] = ms
        # prefer the per-file method the extractor actually took (embedded_text/vision/...)
        method[inv.file_id] = getattr(extractor, "last_method", None) or (
            extractor.name if inv.extraction_ok else f"{extractor.name}(low-conf)")
        if manually_corrected:
            method[inv.file_id] = f"{method[inv.file_id]}+human-override"
            manual_override_count += 1
        costs[inv.file_id] = float(getattr(extractor, "last_cost", 0.0) or 0.0)
        _emit(stream, {"event": "extracted", "i": i, "total": len(files),
                       "file_id": inv.file_id, "ok": inv.extraction_ok, "latency_ms": round(ms, 1)})

    # 2) decide (deterministic, cheap) — needs the whole batch for duplicate detection
    outcomes = decide_batch(invoices, biz, erp, today=today)

    # 3) persist + emit each decision
    if replace_state:
        state.retain_decisions(conn, (o.file_id for o in outcomes))
    for o in outcomes:
        state.record_decision(
            conn, run_id, o,
            extraction_method=method.get(o.file_id),
            extraction_ok=(o.reason != "incomplete_extraction"),
            extracted=next((inv.model_dump() for inv in invoices if inv.file_id == o.file_id), None),
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
        "cost_usd": total_cost,
    }
    state.finish_run(conn, run_id, elapsed_s=elapsed, cost_usd=total_cost, stats=stats)

    # 4) deliverable
    write_outcomes(outcomes, outcomes_path)

    summary = state.snapshot(db_path)["summary"]
    _emit(stream, {"event": "run_done", "run_id": run_id, "elapsed_s": round(elapsed, 2),
                   "files_per_s": round(len(files) / elapsed, 1) if elapsed else 0, "summary": summary})
    conn.close()
    return {"run_id": run_id, "elapsed_s": elapsed, "summary": summary,
            "outcomes": str(outcomes_path)}


def _main() -> int:
    ap = argparse.ArgumentParser(description="Run the invoice-decision batch pipeline.")
    ap.add_argument("--extractor", default=None, help="hybrid (default) | baseline; overrides policy")
    ap.add_argument("--dir", help="directory of invoice PDFs (default: challenge/facturas)")
    ap.add_argument("--batch", default="lote1", choices=["lote1", "lote2"])
    ap.add_argument("--out", help="output JSONL path (default: batch-specific artifact)")
    ap.add_argument("--stream", action="store_true", help="emit JSON progress lines (for the webapp SSE)")
    ap.add_argument("--today", help="reference date YYYY-MM-DD for rule 4 (default: today)")
    ap.add_argument("--limit", type=int, help="process only the first N files (dev)")
    ap.add_argument("--no-vision", action="store_true", help="skip the vision model for scans (digital only)")
    ap.add_argument(
        "--replace-state", action="store_true",
        help="replace the visible decisions with this batch after successful extraction",
    )
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else None
    facturas_dir = Path(args.dir) if args.dir else input_dir_for_batch(args.batch)
    outcomes_path = Path(args.out) if args.out else outcomes_path_for_batch(args.batch)
    result = run(facturas_dir=facturas_dir, extractor_name=args.extractor, batch=args.batch,
                 stream=args.stream, today=today, limit=args.limit, use_vision=not args.no_vision,
                 replace_state=args.replace_state, outcomes_path=outcomes_path)
    if not args.stream:
        print(f"run {result['run_id']}: {result['summary']} in {result['elapsed_s']:.2f}s -> {result['outcomes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
