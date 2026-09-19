from __future__ import annotations

import json

import pytest

from src.deliverables import validate_outcomes


def _write(path, rows):
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def test_validate_outcomes_accepts_exact_batch_contract(tmp_path):
    path = tmp_path / "outcomes_lote2.jsonl"
    _write(path, [
        {"file_id": "uno.pdf", "result": "PAGAR"},
        {"file_id": "dos.pdf", "result": "ESCALAR", "trace": "allowed"},
    ])

    result = validate_outcomes(path, ["uno.pdf", "dos.pdf"])

    assert result == {
        "path": str(path),
        "total": 2,
        "PAGAR": 1,
        "NO_PAGAR": 0,
        "ESCALAR": 1,
    }


@pytest.mark.parametrize(
    ("rows", "expected", "message"),
    [
        ([{"file_id": "uno.pdf", "result": "PAGAR"}], ["uno.pdf", "dos.pdf"], "missing"),
        ([{"file_id": "otro.pdf", "result": "PAGAR"}], ["uno.pdf"], "missing"),
        ([
            {"file_id": "uno.pdf", "result": "PAGAR"},
            {"file_id": "uno.pdf", "result": "PAGAR"},
        ], ["uno.pdf"], "duplicate"),
        ([{"file_id": "uno.pdf", "result": "DUDAR"}], ["uno.pdf"], "invalid result"),
    ],
)
def test_validate_outcomes_rejects_invalid_contract(tmp_path, rows, expected, message):
    path = tmp_path / "outcomes.jsonl"
    _write(path, rows)

    with pytest.raises(ValueError, match=message):
        validate_outcomes(path, expected)
