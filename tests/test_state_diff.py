"""Change-impact diff over decision_history: which decisions flipped, and why.

This is what makes a rule change (v3 -> v4) or an ERP/master update auditable in
the console, so it gets the same test rigour as the rest of the state layer.
"""
from src import state
from src.models import Outcome


def _seed(conn, run_id, batch, rules_version, rows):
    state.start_run(conn, run_id, batch, rules_version)
    for file_id, result, reason in rows:
        state.record_decision(
            conn,
            run_id,
            Outcome(file_id=file_id, result=result, reason=reason, rules_version=rules_version),
            extraction_method="test",
            extraction_ok=True,
            extracted={},
            latency_ms=1,
        )


def test_diff_runs_detects_result_and_reason_changes(tmp_path):
    db = tmp_path / "state.sqlite"
    conn = state.connect(db)
    try:
        _seed(conn, "run-v3", "lote1", "norma-v3", [
            ("a.pdf", "ESCALAR", "iban_mismatch"),      # will flip result
            ("b.pdf", "PAGAR", "all_rules_pass"),        # unchanged
            ("c.pdf", "ESCALAR", "amount_mismatch"),     # reason-only change
            ("gone.pdf", "PAGAR", "all_rules_pass"),     # removed in v4
        ])
        _seed(conn, "run-v4", "lote1", "norma-v4", [
            ("a.pdf", "PAGAR", "all_rules_pass"),        # result flip ESCALAR->PAGAR
            ("b.pdf", "PAGAR", "all_rules_pass"),        # unchanged
            ("c.pdf", "ESCALAR", "future_date"),         # same result, new reason
            ("new.pdf", "NO_PAGAR", "already_paid"),     # added in v4
        ])
        conn.commit()
    finally:
        conn.close()

    d = state.diff_runs("run-v3", "run-v4", db)

    assert d["summary"] == {
        "files_a": 4, "files_b": 4, "common": 3,
        "result_changed": 1, "reason_changed": 1, "added": 1, "removed": 1,
    }
    assert d["added"] == ["new.pdf"]
    assert d["removed"] == ["gone.pdf"]

    rc = d["result_changes"][0]
    assert rc["file_id"] == "a.pdf"
    assert rc["from"]["result"] == "ESCALAR" and rc["to"]["result"] == "PAGAR"

    rr = d["reason_changes"][0]
    assert rr["file_id"] == "c.pdf"
    assert rr["from_reason"] == "amount_mismatch" and rr["to_reason"] == "future_date"

    assert {"from": "ESCALAR", "to": "PAGAR", "count": 1} in d["transitions"]
    assert d["run_a"]["rules_version"] == "norma-v3"
    assert d["run_b"]["rules_version"] == "norma-v4"


def test_list_runs_returns_all_runs(tmp_path):
    db = tmp_path / "state.sqlite"
    conn = state.connect(db)
    try:
        state.start_run(conn, "run-1", "lote1", "norma-v3")
        state.start_run(conn, "run-2", "lote2", "norma-v4")
        conn.commit()
    finally:
        conn.close()
    runs = state.list_runs(db)
    assert {r["run_id"] for r in runs} == {"run-1", "run-2"}
