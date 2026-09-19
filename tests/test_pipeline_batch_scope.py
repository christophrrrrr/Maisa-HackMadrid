from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import pipeline, state
from src.models import Outcome


def test_collect_files_deduplicates_renamed_identical_upload(tmp_path, monkeypatch):
    facturas = tmp_path / "facturas"
    inbox = tmp_path / "inbox"
    facturas.mkdir()
    inbox.mkdir()

    (facturas / "factura_informática.pdf").write_bytes(b"same invoice")
    (inbox / "factura_inform_tica.pdf").write_bytes(b"same invoice")
    (inbox / "factura_nueva.pdf").write_bytes(b"different invoice")
    monkeypatch.setattr(pipeline, "INBOX_DIR", inbox)

    files = pipeline._collect_files(facturas, limit=None)

    assert [file.name for file in files] == [
        "factura_informática.pdf",
        "factura_nueva.pdf",
    ]


def test_retain_decisions_removes_files_from_previous_batch(tmp_path):
    db = tmp_path / "state.sqlite"
    conn = state.connect(db)
    try:
        for file_id in ("keep.pdf", "stale.pdf"):
            state.record_decision(
                conn,
                "run-1",
                Outcome(file_id=file_id, result="ESCALAR", reason="test"),
                extraction_method="test",
                extraction_ok=True,
                extracted={},
                latency_ms=0,
            )
        state.retain_decisions(conn, ["keep.pdf"])
        conn.commit()
    finally:
        conn.close()

    assert [item["file_id"] for item in state.snapshot(db)["decisions"]] == ["keep.pdf"]
