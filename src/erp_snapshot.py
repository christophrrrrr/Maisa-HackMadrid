"""Persist the ERP snapshot to SQLite so downstream work is offline & fast.

Idempotent by design: re-running upserts by asiento_id. That matters because on
Sunday Alberto may change one ERP datum live — we just re-snapshot and the
changed rows update in place, everything else stays. Each run is also logged in
`snapshot_runs` for observability (when, how many, retries, timing).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .erp_client import ERPClient
from .models import ERPEntry

DEFAULT_DB = Path(__file__).resolve().parents[1] / "outputs" / "erp_snapshot.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS erp_asientos (
    asiento_id      TEXT PRIMARY KEY,
    purchase_order  TEXT NOT NULL,
    supplier_id     TEXT NOT NULL,
    tax_id          TEXT NOT NULL,
    expected_amount TEXT NOT NULL,   -- Decimal as string, exact
    status          TEXT NOT NULL,   -- PENDIENTE | PAGADA
    date            TEXT NOT NULL,   -- ISO yyyy-mm-dd
    fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asientos_pedido ON erp_asientos(purchase_order);
CREATE TABLE IF NOT EXISTS snapshot_runs (
    run_at   TEXT PRIMARY KEY,
    total    INTEGER NOT NULL,
    stats    TEXT NOT NULL
);
"""


def save_snapshot(entries: list[ERPEntry], db_path: Path = DEFAULT_DB, stats: dict | None = None) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(_SCHEMA)
        conn.executemany(
            """INSERT INTO erp_asientos
               (asiento_id, purchase_order, supplier_id, tax_id, expected_amount, status, date, fetched_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(asiento_id) DO UPDATE SET
                 purchase_order=excluded.purchase_order,
                 supplier_id=excluded.supplier_id,
                 tax_id=excluded.tax_id,
                 expected_amount=excluded.expected_amount,
                 status=excluded.status,
                 date=excluded.date,
                 fetched_at=excluded.fetched_at""",
            [
                (e.asiento_id, e.purchase_order, e.supplier_id, e.tax_id,
                 str(e.expected_amount), e.status, e.date.isoformat(), now)
                for e in entries
            ],
        )
        conn.execute(
            "INSERT OR REPLACE INTO snapshot_runs (run_at, total, stats) VALUES (?,?,?)",
            (now, len(entries), json.dumps(stats or {})),
        )
        conn.commit()
    finally:
        conn.close()


def load_snapshot(db_path: Path = DEFAULT_DB) -> list[ERPEntry]:
    """Read the cached snapshot back as ERPEntry[] (offline, no ERP needed)."""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT asiento_id, purchase_order, supplier_id, tax_id, expected_amount, status, date "
            "FROM erp_asientos"
        ).fetchall()
    finally:
        conn.close()
    return [
        ERPEntry(
            asiento_id=r[0], purchase_order=r[1], supplier_id=r[2], tax_id=r[3],
            expected_amount=r[4], status=r[5], date=r[6],
        )
        for r in rows
    ]


def index_by_pedido(entries: list[ERPEntry]) -> dict[str, ERPEntry]:
    """Reconciliation helper: pedido -> asiento (what B will call)."""
    return {e.purchase_order: e for e in entries}


def refresh(db_path: Path = DEFAULT_DB, **client_kwargs) -> tuple[list[ERPEntry], dict]:
    """Fetch everything from the live ERP and persist it. Returns (entries, stats)."""
    client = ERPClient(**client_kwargs)
    entries = client.fetch_all()
    save_snapshot(entries, db_path=db_path, stats=client.stats.as_dict())
    return entries, client.stats.as_dict()


def _main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Snapshot the legacy ERP into SQLite.")
    ap.add_argument("--base-url", default="http://127.0.0.1:8009")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    entries, stats = refresh(db_path=Path(args.db), base_url=args.base_url, verbose=not args.quiet)

    paid = sum(1 for e in entries if e.status == "PAGADA")
    pending = sum(1 for e in entries if e.status == "PENDIENTE")
    print(f"\nSnapshot OK -> {args.db}")
    print(f"  asientos : {len(entries)}  (PENDIENTE={pending}, PAGADA={paid})")
    print(f"  stats    : {stats}")
    print("  sample   :", entries[0].model_dump() if entries else "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
