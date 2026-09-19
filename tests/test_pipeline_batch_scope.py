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


def test_each_batch_has_an_isolated_default_input_and_output():
    assert pipeline.input_dir_for_batch("lote1") != pipeline.input_dir_for_batch("lote2")
    assert pipeline.outcomes_path_for_batch("lote1").name == "outcomes.jsonl"
    assert pipeline.outcomes_path_for_batch("lote2").name == "outcomes_lote2.jsonl"
    assert pipeline.rules_version_for_batch("lote1") == "norma-v3"
    assert pipeline.rules_version_for_batch("lote2") == "norma-v4"


def test_writing_lote2_does_not_overwrite_lote1(tmp_path):
    lote1 = tmp_path / "outcomes.jsonl"
    lote2 = tmp_path / "outcomes_lote2.jsonl"
    pipeline.write_outcomes(
        [Outcome(file_id="lote1.pdf", result="PAGAR", reason="test")],
        lote1,
    )
    original = lote1.read_text(encoding="utf-8")

    pipeline.write_outcomes(
        [Outcome(file_id="lote2.pdf", result="ESCALAR", reason="test")],
        lote2,
    )

    assert lote1.read_text(encoding="utf-8") == original
    assert '"file_id": "lote2.pdf"' in lote2.read_text(encoding="utf-8")


def test_lote2_collection_never_inherits_lote1_inbox(tmp_path, monkeypatch):
    missing_lote2 = tmp_path / "missing-lote2"
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / "lote1-upload.pdf").write_bytes(b"lote 1")
    monkeypatch.setattr(pipeline, "INBOX_DIR", inbox)

    files = pipeline._collect_files(
        missing_lote2,
        limit=None,
        include_inbox=False,
    )

    assert files == []


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
