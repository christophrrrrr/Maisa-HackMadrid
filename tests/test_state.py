from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import state
from src.models import Outcome


def _record(conn, run_id: str, file_id: str, result: str, reason: str) -> None:
    state.record_decision(
        conn,
        run_id,
        Outcome(file_id=file_id, result=result, reason=reason),
        extraction_method="test",
        extraction_ok=True,
        extracted={},
        latency_ms=1,
    )


def test_delete_run_restores_previous_decision(tmp_path):
    db = tmp_path / "state.sqlite"
    conn = state.connect(db)
    try:
        state.start_run(conn, "run-a", "lote1", "norma-v3")
        _record(conn, "run-a", "same.pdf", "PAGAR", "ok")
        state.finish_run(conn, "run-a", elapsed_s=1, cost_usd=0, stats={})
        state.start_run(conn, "run-b", "lote2", "norma-v4")
        _record(conn, "run-b", "same.pdf", "ESCALAR", "review")
        _record(conn, "run-b", "only-b.pdf", "NO_PAGAR", "block")
        state.finish_run(conn, "run-b", elapsed_s=1, cost_usd=0, stats={})
    finally:
        conn.close()

    result = state.delete_run("run-b", db)

    snap = state.snapshot(db)
    ids = {d["file_id"]: d for d in snap["decisions"]}
    assert result == {"ok": True, "run_id": "run-b"}
    assert [run["run_id"] for run in snap["recent_runs"]] == ["run-a"]
    assert ids["same.pdf"]["result"] == "PAGAR"
    assert ids["same.pdf"]["run_id"] == "run-a"
    assert "only-b.pdf" not in ids
    assert state.run_decisions("run-b", db) == []


def test_delete_run_missing_is_not_found(tmp_path):
    db = tmp_path / "state.sqlite"
    state.connect(db).close()
    assert state.delete_run("missing", db) == {"ok": False, "error": "not found"}
