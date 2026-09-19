from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from src.erp_snapshot import assert_snapshot_ready_for_batch, load_snapshot, save_snapshot
from src.models import ERPEntry


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


def test_save_snapshot_drops_asientos_absent_from_the_refresh(tmp_path):
    db = tmp_path / "erp.sqlite"
    old = ERPEntry(
        asiento_id="AS-OLD",
        purchase_order="PO-1",
        supplier_id="P001",
        tax_id="A1",
        expected_amount=Decimal("1.00"),
        status="PENDIENTE",
        date=date(2026, 1, 1),
    )
    new = ERPEntry(
        asiento_id="AS-NEW",
        purchase_order="PO-2",
        supplier_id="P002",
        tax_id="A2",
        expected_amount=Decimal("2.00"),
        status="PENDIENTE",
        date=date(2026, 1, 2),
    )
    save_snapshot([old], db_path=db)
    save_snapshot([new], db_path=db)
    assert {entry.asiento_id for entry in load_snapshot(db)} == {"AS-NEW"}


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
