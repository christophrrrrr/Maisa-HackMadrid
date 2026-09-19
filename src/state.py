"""Pipeline state store (SQLite) — the single source of truth the webapp reads.

Python owns ALL database access. The Next.js console never opens SQLite directly;
it calls the CLI (`python -m src.state json`) and gets JSON. This keeps one owner
for the schema and avoids native Node sqlite builds on Windows.

Three tables:
  runs      — one row per batch run (counts, timing, cost, retries, status)
  decisions — current decision per file_id (result, reason, evidence, trace)
  decision_history — immutable per-run trace, including superseded batches
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .models import Outcome

DEFAULT_DB = Path(__file__).resolve().parents[1] / "outputs" / "pipeline_state.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id        TEXT PRIMARY KEY,       -- ISO timestamp of start
    batch         TEXT NOT NULL,          -- 'lote1' | 'lote2'
    rules_version TEXT NOT NULL,
    status        TEXT NOT NULL,          -- 'running' | 'done' | 'error'
    total         INTEGER NOT NULL DEFAULT 0,
    n_pagar       INTEGER NOT NULL DEFAULT 0,
    n_no_pagar    INTEGER NOT NULL DEFAULT 0,
    n_escalar     INTEGER NOT NULL DEFAULT 0,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    elapsed_s     REAL,
    files_per_s   REAL,
    cost_usd      REAL NOT NULL DEFAULT 0,
    stats         TEXT NOT NULL DEFAULT '{}'   -- extractor mix, retries, errors...
);
CREATE TABLE IF NOT EXISTS decisions (
    file_id            TEXT PRIMARY KEY,
    run_id             TEXT NOT NULL,
    result             TEXT NOT NULL,       -- PAGAR | NO_PAGAR | ESCALAR
    reason             TEXT NOT NULL,
    findings           TEXT NOT NULL,       -- json array
    evidence           TEXT NOT NULL,       -- json object
    rules_version      TEXT NOT NULL,
    extraction_method  TEXT,                -- 'baseline-regex' | 'llm-vision' | ...
    extraction_ok      INTEGER NOT NULL DEFAULT 1,
    extracted          TEXT,                -- json of InvoiceData (the parsed fields)
    latency_ms         REAL,
    cost_usd           REAL NOT NULL DEFAULT 0,
    updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_result ON decisions(result);
CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions(run_id);
CREATE TABLE IF NOT EXISTS decision_history (
    run_id             TEXT NOT NULL,
    batch              TEXT NOT NULL,
    file_id            TEXT NOT NULL,
    result             TEXT NOT NULL,
    reason             TEXT NOT NULL,
    findings           TEXT NOT NULL,
    evidence           TEXT NOT NULL,
    rules_version      TEXT NOT NULL,
    extraction_method  TEXT,
    extraction_ok      INTEGER NOT NULL DEFAULT 1,
    extracted          TEXT,
    latency_ms         REAL,
    cost_usd           REAL NOT NULL DEFAULT 0,
    updated_at         TEXT NOT NULL,
    PRIMARY KEY (run_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_history_batch ON decision_history(batch, run_id);
"""


def connect(db_path: Path = DEFAULT_DB) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    # One-time, idempotent migration for state created before per-run history
    # existed. This preserves lote 1 before lote 2 replaces the visible board.
    conn.execute(
        """INSERT OR IGNORE INTO decision_history
           (run_id, batch, file_id, result, reason, findings, evidence, rules_version,
            extraction_method, extraction_ok, extracted, latency_ms, cost_usd, updated_at)
           SELECT d.run_id, COALESCE(r.batch, 'unknown'), d.file_id, d.result, d.reason,
                  d.findings, d.evidence, d.rules_version, d.extraction_method,
                  d.extraction_ok, d.extracted, d.latency_ms, d.cost_usd, d.updated_at
           FROM decisions d LEFT JOIN runs r ON r.run_id = d.run_id"""
    )
    conn.commit()
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_run(conn: sqlite3.Connection, run_id: str, batch: str, rules_version: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO runs (run_id, batch, rules_version, status, started_at) "
        "VALUES (?,?,?,?,?)",
        (run_id, batch, rules_version, "running", _now()),
    )
    conn.commit()


def record_decision(
    conn: sqlite3.Connection,
    run_id: str,
    outcome: Outcome,
    *,
    extraction_method: str | None,
    extraction_ok: bool,
    extracted: dict | None,
    latency_ms: float | None,
    cost_usd: float = 0.0,
) -> None:
    batch_row = conn.execute("SELECT batch FROM runs WHERE run_id=?", (run_id,)).fetchone()
    if batch_row is None:
        raise ValueError(f"run {run_id!r} must be started before recording decisions")
    batch = batch_row[0]
    now = _now()
    findings = json.dumps(outcome.findings)
    evidence = json.dumps(outcome.evidence)
    extracted_json = json.dumps(extracted or {}, default=str)
    conn.execute(
        """INSERT INTO decisions
           (file_id, run_id, result, reason, findings, evidence, rules_version,
            extraction_method, extraction_ok, extracted, latency_ms, cost_usd, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(file_id) DO UPDATE SET
             run_id=excluded.run_id, result=excluded.result, reason=excluded.reason,
             findings=excluded.findings, evidence=excluded.evidence,
             rules_version=excluded.rules_version, extraction_method=excluded.extraction_method,
             extraction_ok=excluded.extraction_ok, extracted=excluded.extracted,
             latency_ms=excluded.latency_ms, cost_usd=excluded.cost_usd,
             updated_at=excluded.updated_at""",
        (
            outcome.file_id, run_id, outcome.result, outcome.reason,
            findings, evidence, outcome.rules_version,
            extraction_method, int(extraction_ok), extracted_json,
            latency_ms, cost_usd, now,
        ),
    )
    conn.execute(
        """INSERT OR REPLACE INTO decision_history
           (run_id, batch, file_id, result, reason, findings, evidence, rules_version,
            extraction_method, extraction_ok, extracted, latency_ms, cost_usd, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            run_id, batch, outcome.file_id, outcome.result, outcome.reason,
            findings, evidence, outcome.rules_version, extraction_method,
            int(extraction_ok), extracted_json, latency_ms, cost_usd, now,
        ),
    )


def retain_decisions(conn: sqlite3.Connection, file_ids) -> None:
    """Keep only decisions belonging to the current replacement batch.

    The temporary table avoids SQLite's parameter limit for large batches. The
    caller controls the transaction, so a failed extraction cannot wipe the
    last successful board.
    """
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS current_batch_files (file_id TEXT PRIMARY KEY)")
    conn.execute("DELETE FROM current_batch_files")
    conn.executemany(
        "INSERT OR IGNORE INTO current_batch_files (file_id) VALUES (?)",
        ((file_id,) for file_id in file_ids),
    )
    conn.execute(
        "DELETE FROM decisions WHERE file_id NOT IN (SELECT file_id FROM current_batch_files)"
    )
    conn.execute("DROP TABLE current_batch_files")


def finish_run(conn: sqlite3.Connection, run_id: str, *, elapsed_s: float, cost_usd: float, stats: dict) -> None:
    counts = dict(conn.execute(
        "SELECT result, COUNT(*) n FROM decisions WHERE run_id=? GROUP BY result", (run_id,)
    ).fetchall())
    total = sum(counts.values())
    conn.execute(
        """UPDATE runs SET status='done', total=?, n_pagar=?, n_no_pagar=?, n_escalar=?,
             finished_at=?, elapsed_s=?, files_per_s=?, cost_usd=?, stats=? WHERE run_id=?""",
        (total, counts.get("PAGAR", 0), counts.get("NO_PAGAR", 0), counts.get("ESCALAR", 0),
         _now(), elapsed_s, (total / elapsed_s if elapsed_s else 0), cost_usd,
         json.dumps(stats), run_id),
    )
    conn.commit()


# ---------- read side (what the webapp consumes as JSON) ----------

def _row_to_decision(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in ("findings", "evidence", "extracted"):
        try:
            d[k] = json.loads(d[k]) if d[k] else None
        except (json.JSONDecodeError, TypeError):
            pass
    d["extraction_ok"] = bool(d["extraction_ok"])
    return d


def snapshot(db_path: Path = DEFAULT_DB) -> dict:
    """Everything the console needs, as one JSON-able dict."""
    conn = connect(db_path)
    try:
        latest = conn.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1").fetchone()
        run = dict(latest) if latest else None
        if run and run.get("stats"):
            try:
                run["stats"] = json.loads(run["stats"])
            except json.JSONDecodeError:
                pass
        decisions = [_row_to_decision(r) for r in
                     conn.execute("SELECT * FROM decisions ORDER BY result, file_id").fetchall()]
        summary = dict(conn.execute(
            "SELECT result, COUNT(*) n FROM decisions GROUP BY result").fetchall())
        return {
            "latest_run": run,
            "summary": {
                "total": len(decisions),
                "PAGAR": summary.get("PAGAR", 0),
                "NO_PAGAR": summary.get("NO_PAGAR", 0),
                "ESCALAR": summary.get("ESCALAR", 0),
            },
            "decisions": decisions,
        }
    finally:
        conn.close()


def decision(file_id: str, db_path: Path = DEFAULT_DB) -> dict | None:
    conn = connect(db_path)
    try:
        r = conn.execute("SELECT * FROM decisions WHERE file_id=?", (file_id,)).fetchone()
        return _row_to_decision(r) if r else None
    finally:
        conn.close()


def run_decisions(run_id: str, db_path: Path = DEFAULT_DB) -> list[dict]:
    """Return the preserved trace for a specific run, even after later batches."""
    conn = connect(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM decision_history WHERE run_id=? ORDER BY file_id",
            (run_id,),
        ).fetchall()
        return [_row_to_decision(row) for row in rows]
    finally:
        conn.close()


def clear(db_path: Path = DEFAULT_DB) -> dict:
    """wipe runs + decisions so the console can start from a blank board."""
    conn = connect(db_path)
    try:
        conn.execute("DELETE FROM decisions")
        conn.execute("DELETE FROM decision_history")
        conn.execute("DELETE FROM runs")
        conn.commit()
    finally:
        conn.close()
    outputs = Path(__file__).resolve().parents[1] / "outputs"
    for name in ("outcomes.jsonl", "outcomes_lote2.jsonl"):
        outcomes = outputs / name
        if outcomes.exists():
            outcomes.write_text("", encoding="utf-8")
    return {"ok": True}


def _main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Pipeline state store (read side / CLI for the webapp).")
    ap.add_argument(
        "cmd",
        choices=["json", "decision", "run", "clear"],
        help="json = snapshot; decision = current file; run = preserved run trace; clear = wipe",
    )
    ap.add_argument("--file-id")
    ap.add_argument("--run-id")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()

    if args.cmd == "json":
        print(json.dumps(snapshot(Path(args.db)), default=str))
    elif args.cmd == "clear":
        print(json.dumps(clear(Path(args.db)), default=str))
    elif args.cmd == "run":
        if not args.run_id:
            ap.error("run requires --run-id")
        print(json.dumps(run_decisions(args.run_id, Path(args.db)), default=str))
    else:
        print(json.dumps(decision(args.file_id, Path(args.db)), default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
