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
import json
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

from . import state
from .business_data import load_business_data
from .erp_snapshot import index_by_pedido, load_snapshot
from .extractor import AutoExtractor
from .models import InvoiceData
from .policy import load_policy
from .rules_engine import decide_batch

REPO = Path(__file__).resolve().parents[1]
FACTURAS_DIR = REPO / "challenge" / "facturas"
OUTCOMES = REPO / "outputs" / "outcomes.jsonl"


def _emit(stream: bool, obj: dict) -> None:
    """Progress line for the webapp (SSE) and/or human logs."""
    if stream:
        sys.stdout.write(json.dumps(obj, default=str) + "\n")
        sys.stdout.flush()


def run(
    *,
    facturas_dir: Path = FACTURAS_DIR,
    batch: str = "lote1",
    today: date | None = None,
    stream: bool = False,
    db_path: Path = state.DEFAULT_DB,
    limit: int | None = None,
) -> dict:
    # reference date falls back to the editable policy (settings page)
    cfg = load_policy()
    if today is None and cfg.get("today"):
        today = date.fromisoformat(cfg["today"])
    today = today or date.today()
    extractor = AutoExtractor()
    biz = load_business_data()
    erp = index_by_pedido(load_snapshot())

    files = sorted(facturas_dir.glob("*.pdf")) if facturas_dir.is_dir() else []
    if limit:
        files = files[:limit]
    run_id = datetime.now(timezone.utc).isoformat()

    conn = state.connect(db_path)
    state.start_run(conn, run_id, batch, biz.rules_version)
    _emit(stream, {"event": "run_start", "run_id": run_id, "total": len(files),
                   "extractor": extractor.name, "rules_version": biz.rules_version})

    # 1) extract (the slow, probabilistic part) — measure per file
    invoices: list[InvoiceData] = []
    latencies: dict[str, float] = {}
    method: dict[str, str] = {}
    t0 = time.monotonic()
    for i, f in enumerate(files, 1):
        s = time.monotonic()
        inv = extractor.extract(f)
        ms = (time.monotonic() - s) * 1000
        invoices.append(inv)
        latencies[inv.file_id] = ms
        method[inv.file_id] = extractor.name if inv.extraction_ok else f"{extractor.name}(low-conf)"
        _emit(stream, {"event": "extracted", "i": i, "total": len(files),
                       "file_id": inv.file_id, "ok": inv.extraction_ok, "latency_ms": round(ms, 1)})

    # 2) decide (deterministic, cheap) — needs the whole batch for duplicate detection
    outcomes = decide_batch(invoices, biz, erp, today=today)

    # 3) persist + emit each decision
    for o in outcomes:
        state.record_decision(
            conn, run_id, o,
            extraction_method=method.get(o.file_id),
            extraction_ok=(o.reason != "incomplete_extraction"),
            extracted=next((inv.model_dump() for inv in invoices if inv.file_id == o.file_id), None),
            latency_ms=latencies.get(o.file_id),
            cost_usd=0.0,  # baseline is free; A's LLM extractor fills real cost here
        )
        _emit(stream, {"event": "decided", "file_id": o.file_id, "result": o.result, "reason": o.reason})
    conn.commit()

    elapsed = time.monotonic() - t0
    stats = {
        "extractor": extractor.name,
        "extractor_low_conf": sum(1 for v in method.values() if "low-conf" in v),
        "avg_latency_ms": round(sum(latencies.values()) / len(latencies), 1) if latencies else 0,
    }
    state.finish_run(conn, run_id, elapsed_s=elapsed, cost_usd=0.0, stats=stats)

    # 4) deliverable
    OUTCOMES.parent.mkdir(parents=True, exist_ok=True)
    with OUTCOMES.open("w", encoding="utf-8") as fh:
        for o in outcomes:
            fh.write(json.dumps(o.to_contract_line(), ensure_ascii=False) + "\n")

    summary = state.snapshot(db_path)["summary"]
    _emit(stream, {"event": "run_done", "run_id": run_id, "elapsed_s": round(elapsed, 2),
                   "files_per_s": round(len(files) / elapsed, 1) if elapsed else 0, "summary": summary})
    conn.close()
    return {"run_id": run_id, "elapsed_s": elapsed, "summary": summary, "outcomes": str(OUTCOMES)}


def _main() -> int:
    ap = argparse.ArgumentParser(description="Run the invoice-decision batch pipeline.")
    ap.add_argument("--dir", help="directory of invoice PDFs (default: challenge/facturas)")
    ap.add_argument("--batch", default="lote1", choices=["lote1", "lote2"])
    ap.add_argument("--stream", action="store_true", help="emit JSON progress lines (for the webapp SSE)")
    ap.add_argument("--today", help="reference date YYYY-MM-DD for rule 4 (default: today)")
    ap.add_argument("--limit", type=int, help="process only the first N files (dev)")
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else None
    facturas_dir = Path(args.dir) if args.dir else FACTURAS_DIR
    result = run(facturas_dir=facturas_dir, batch=args.batch, stream=args.stream,
                 today=today, limit=args.limit)
    if not args.stream:
        print(f"run {result['run_id']}: {result['summary']} in {result['elapsed_s']:.2f}s -> {result['outcomes']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
