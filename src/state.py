"""Pipeline state store (SQLite) — the single source of truth the webapp reads.

Python owns ALL database access. The Next.js console never opens SQLite directly;
it calls the CLI (`python -m src.state json`) and gets JSON. This keeps one owner
for the schema and avoids native Node sqlite builds on Windows.

Three tables:
  runs              — one row per batch run (counts, timing, cost, retries, status)
  decisions         — current decision per file_id (latest state for the board)
  decision_history  — append-only audit trail keyed by (run_id, file_id)
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
    detail             TEXT,
    findings           TEXT NOT NULL,       -- json array
    evidence           TEXT NOT NULL,       -- json object
    checks             TEXT NOT NULL DEFAULT '[]', -- json array
    rules_version      TEXT NOT NULL,
    extraction_method  TEXT,                -- 'baseline-regex' | 'llm-vision' | ...
    extraction_ok      INTEGER NOT NULL DEFAULT 1,
    extracted          TEXT,                -- json of InvoiceData (the parsed fields)
    extraction_evidence TEXT NOT NULL DEFAULT '{}', -- field -> page/snippet
    latency_ms         REAL,
    cost_usd           REAL NOT NULL DEFAULT 0,
    updated_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decision_history (
    run_id             TEXT NOT NULL,
    batch              TEXT NOT NULL,
    file_id            TEXT NOT NULL,
    result             TEXT NOT NULL,
    reason             TEXT NOT NULL,
    detail             TEXT,
    findings           TEXT NOT NULL,
    evidence           TEXT NOT NULL,
    checks             TEXT NOT NULL DEFAULT '[]',
    rules_version      TEXT NOT NULL,
    extraction_method  TEXT,
    extraction_ok      INTEGER NOT NULL DEFAULT 1,
    extracted          TEXT,
    extraction_evidence TEXT NOT NULL DEFAULT '{}',
    latency_ms         REAL,
    cost_usd           REAL NOT NULL DEFAULT 0,
    recorded_at        TEXT NOT NULL,
    PRIMARY KEY (run_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_decisions_result ON decisions(result);
CREATE INDEX IF NOT EXISTS idx_decisions_run ON decisions(run_id);
"""


def connect(db_path: Path = DEFAULT_DB) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    decision_columns = {row["name"] for row in conn.execute("PRAGMA table_info(decisions)")}
    decision_migrations = {
        "detail": "ALTER TABLE decisions ADD COLUMN detail TEXT",
        "checks": "ALTER TABLE decisions ADD COLUMN checks TEXT NOT NULL DEFAULT '[]'",
        "extraction_evidence": (
            "ALTER TABLE decisions ADD COLUMN extraction_evidence TEXT NOT NULL DEFAULT '{}'"
        ),
    }
    for name, statement in decision_migrations.items():
        if name not in decision_columns:
            conn.execute(statement)

    history_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(decision_history)")
    }
    history_migrations = {
        "detail": "ALTER TABLE decision_history ADD COLUMN detail TEXT",
        "checks": "ALTER TABLE decision_history ADD COLUMN checks TEXT NOT NULL DEFAULT '[]'",
        "extraction_evidence": (
            "ALTER TABLE decision_history ADD COLUMN extraction_evidence TEXT NOT NULL DEFAULT '{}'"
        ),
        "batch": "ALTER TABLE decision_history ADD COLUMN batch TEXT",
        "recorded_at": "ALTER TABLE decision_history ADD COLUMN recorded_at TEXT",
    }
    for name, statement in history_migrations.items():
        if name not in history_columns:
            conn.execute(statement)

    # normalize history created by either earlier schema
    conn.execute(
        """UPDATE decision_history
           SET batch = COALESCE(
               batch,
               (SELECT runs.batch FROM runs WHERE runs.run_id = decision_history.run_id),
               'unknown'
           )
           WHERE batch IS NULL"""
    )
    if "recorded_at" not in history_columns:
        if "updated_at" in history_columns:
            conn.execute(
                """UPDATE decision_history
                   SET recorded_at = updated_at
                   WHERE recorded_at IS NULL"""
            )
        else:
            conn.execute(
                "UPDATE decision_history SET recorded_at = ? WHERE recorded_at IS NULL",
                (_now(),),
            )
    _backfill_history(conn)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_recorded ON decision_history(recorded_at)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_history_file ON decision_history(file_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_batch ON decision_history(batch, run_id)"
    )
    conn.commit()
    return conn


def _backfill_history(conn: sqlite3.Connection) -> None:
    """seed history from current decisions once, so existing data is not lost."""
    count = conn.execute("SELECT COUNT(*) AS n FROM decision_history").fetchone()["n"]
    if count > 0:
        return
    conn.execute(
        """INSERT OR IGNORE INTO decision_history
           (run_id, batch, file_id, result, reason, detail, findings, evidence, checks,
            rules_version, extraction_method, extraction_ok, extracted,
            extraction_evidence, latency_ms, cost_usd, recorded_at)
           SELECT d.run_id, COALESCE(r.batch, 'unknown'), d.file_id, d.result, d.reason,
                  d.detail, d.findings, d.evidence, d.checks, d.rules_version,
                  d.extraction_method, d.extraction_ok, d.extracted,
                  d.extraction_evidence, d.latency_ms, d.cost_usd, d.updated_at
           FROM decisions d LEFT JOIN runs r ON r.run_id = d.run_id"""
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_run(conn: sqlite3.Connection, run_id: str, batch: str, rules_version: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO runs (run_id, batch, rules_version, status, started_at) "
        "VALUES (?,?,?,?,?)",
        (run_id, batch, rules_version, "running", _now()),
    )
    conn.commit()


def _decision_values(
    run_id: str,
    outcome: Outcome,
    *,
    extraction_method: str | None,
    extraction_ok: bool,
    extracted: dict | None,
    extraction_evidence: dict | None,
    latency_ms: float | None,
    cost_usd: float,
    when: str,
) -> tuple:
    return (
        outcome.file_id, run_id, outcome.result, outcome.reason,
        outcome.detail, json.dumps(outcome.findings), json.dumps(outcome.evidence, default=str),
        json.dumps([check.model_dump() for check in outcome.checks], default=str),
        outcome.rules_version,
        extraction_method, int(extraction_ok), json.dumps(extracted or {}, default=str),
        json.dumps(extraction_evidence or {}, default=str),
        latency_ms, cost_usd, when,
    )


def record_decision(
    conn: sqlite3.Connection,
    run_id: str,
    outcome: Outcome,
    *,
    extraction_method: str | None,
    extraction_ok: bool,
    extracted: dict | None,
    extraction_evidence: dict | None = None,
    latency_ms: float | None,
    cost_usd: float = 0.0,
) -> None:
    batch_row = conn.execute("SELECT batch FROM runs WHERE run_id=?", (run_id,)).fetchone()
    if batch_row is None:
        raise ValueError(f"run {run_id!r} must be started before recording decisions")
    when = _now()
    values = _decision_values(
        run_id, outcome,
        extraction_method=extraction_method,
        extraction_ok=extraction_ok,
        extracted=extracted,
        extraction_evidence=extraction_evidence,
        latency_ms=latency_ms,
        cost_usd=cost_usd,
        when=when,
    )
    conn.execute(
        """INSERT INTO decisions
           (file_id, run_id, result, reason, detail, findings, evidence, checks, rules_version,
            extraction_method, extraction_ok, extracted, extraction_evidence,
            latency_ms, cost_usd, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(file_id) DO UPDATE SET
             run_id=excluded.run_id, result=excluded.result, reason=excluded.reason,
             detail=excluded.detail, findings=excluded.findings, evidence=excluded.evidence,
             checks=excluded.checks,
             rules_version=excluded.rules_version, extraction_method=excluded.extraction_method,
             extraction_ok=excluded.extraction_ok, extracted=excluded.extracted,
             extraction_evidence=excluded.extraction_evidence,
             latency_ms=excluded.latency_ms, cost_usd=excluded.cost_usd,
             updated_at=excluded.updated_at""",
        values,
    )
    # append-only audit trail; ignore duplicate (run_id, file_id) on retries
    conn.execute(
        """INSERT OR IGNORE INTO decision_history
           (file_id, run_id, batch, result, reason, detail, findings, evidence, checks, rules_version,
            extraction_method, extraction_ok, extracted, extraction_evidence,
            latency_ms, cost_usd, recorded_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (values[0], values[1], batch_row[0], *values[2:]),
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
        "SELECT result, COUNT(*) n FROM decision_history WHERE run_id=? GROUP BY result", (run_id,)
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
    for k in ("findings", "evidence", "checks", "extracted", "extraction_evidence"):
        try:
            d[k] = json.loads(d[k]) if d[k] else None
        except (json.JSONDecodeError, TypeError):
            pass
    d["extraction_ok"] = bool(d["extraction_ok"])
    if "recorded_at" in d and "updated_at" not in d:
        d["updated_at"] = d["recorded_at"]
    return d


def _row_to_run(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    run = dict(r)
    if run.get("stats"):
        try:
            run["stats"] = json.loads(run["stats"])
        except (json.JSONDecodeError, TypeError):
            pass
    return run


def recent_runs(conn: sqlite3.Connection, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [_row_to_run(r) for r in rows if r]


def history(db_path: Path = DEFAULT_DB, *, limit: int = 500, run_id: str | None = None) -> list[dict]:
    """chronological audit records across runs."""
    conn = connect(db_path)
    try:
        if run_id:
            rows = conn.execute(
                """SELECT * FROM decision_history
                   WHERE run_id=?
                   ORDER BY recorded_at DESC, file_id
                   LIMIT ?""",
                (run_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM decision_history
                   ORDER BY recorded_at DESC, file_id
                   LIMIT ?""",
                (limit,),
            ).fetchall()
        return [_row_to_decision(r) for r in rows]
    finally:
        conn.close()


def snapshot(db_path: Path = DEFAULT_DB) -> dict:
    """Everything the console needs, as one JSON-able dict."""
    conn = connect(db_path)
    try:
        runs = recent_runs(conn, limit=20)
        latest = runs[0] if runs else None
        decisions = [_row_to_decision(r) for r in
                     conn.execute("SELECT * FROM decisions ORDER BY result, file_id").fetchall()]
        summary = dict(conn.execute(
            "SELECT result, COUNT(*) n FROM decisions GROUP BY result").fetchall())
        return {
            "latest_run": latest,
            "recent_runs": runs,
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


def purchase_orders_from_other_batches(batch: str, db_path: Path = DEFAULT_DB) -> set[str]:
    """Purchase orders already seen outside the batch being evaluated."""
    conn = connect(db_path)
    try:
        rows = conn.execute(
            """SELECT h.extracted FROM decision_history h
               JOIN runs r ON r.run_id = h.run_id
               WHERE h.batch != ? AND r.status = 'done'""",
            (batch,),
        ).fetchall()
    finally:
        conn.close()

    purchase_orders: set[str] = set()
    for row in rows:
        try:
            extracted = json.loads(row[0]) if row[0] else {}
        except (json.JSONDecodeError, TypeError):
            continue
        purchase_order = extracted.get("purchase_order") if isinstance(extracted, dict) else None
        if isinstance(purchase_order, str) and purchase_order:
            purchase_orders.add(purchase_order)
    return purchase_orders


def clear(db_path: Path = DEFAULT_DB) -> dict:
    """wipe runs + decisions so the console can start from a blank board."""
    conn = connect(db_path)
    try:
        conn.execute("DELETE FROM decision_history")
        conn.execute("DELETE FROM decisions")
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
        choices=["json", "decision", "history", "run", "clear"],
        help="json = snapshot; decision = current file; history = audit trail; run = run trace; clear = wipe",
    )
    ap.add_argument("--file-id")
    ap.add_argument("--run-id")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()

    if args.cmd == "json":
        print(json.dumps(snapshot(Path(args.db)), default=str))
    elif args.cmd == "clear":
        print(json.dumps(clear(Path(args.db)), default=str))
    elif args.cmd == "history":
        print(json.dumps(history(Path(args.db), limit=args.limit, run_id=args.run_id), default=str))
    elif args.cmd == "run":
        if not args.run_id:
            ap.error("run requires --run-id")
        print(json.dumps(run_decisions(args.run_id, Path(args.db)), default=str))
    else:
        print(json.dumps(decision(args.file_id, Path(args.db)), default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
