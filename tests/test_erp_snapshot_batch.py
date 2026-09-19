from __future__ import annotations

import pytest

from src.erp_snapshot import assert_snapshot_ready_for_batch, save_snapshot


def test_lote1_accepts_snapshot_without_batch2_provenance(tmp_path):
    db = tmp_path / "erp.sqlite"

    assert_snapshot_ready_for_batch("lote1", db)


def test_lote2_rejects_snapshot_without_loaded_update(tmp_path):
    db = tmp_path / "erp.sqlite"
    save_snapshot([], db_path=db, stats={"erp_status": {"actualizacion_cargada": "NO"}})

    with pytest.raises(RuntimeError, match="actualizacion_cargada=SI"):
        assert_snapshot_ready_for_batch("lote2", db)


def test_lote2_accepts_snapshot_with_loaded_update(tmp_path):
    db = tmp_path / "erp.sqlite"
    save_snapshot([], db_path=db, stats={"erp_status": {"actualizacion_cargada": "SI"}})

    assert_snapshot_ready_for_batch("lote2", db)
