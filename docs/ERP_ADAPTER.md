# ERP adapter (Person C) — done & how to use it

Turns the legacy 2009 ERP bridge into a clean `list[ERPEntry]` and caches it in
SQLite. Downstream code (reconciliation / rules engine) never touches the ERP —
it reads the snapshot.

## Files
- `src/models.py` — the shared `ERPEntry` contract (+ stubs for A/B).
- `src/erp_client.py` — `ERPClient`: login, pagination, and auto-recovery from
  `ORA-00600` (retry), `ERP-429` (wait), `SES-401` (re-login). Collects stats.
- `src/erp_snapshot.py` — persist/load SQLite, idempotent upsert, run log.

## Run it

```bash
# 1. start the ERP (in challenge/)
python alberto_erp.py --rapido            # http://127.0.0.1:8009

# 2. snapshot it (from repo root)
python -m src.erp_snapshot                 # writes outputs/erp_snapshot.sqlite
```

Output: 516 asientos (507 PENDIENTE / 9 PAGADA), ~3.4s, ORA-00600 retries handled.

## How B consumes it (reconciliation)

```python
from src.erp_snapshot import load_snapshot, index_by_pedido

erp = index_by_pedido(load_snapshot())      # offline, no ERP needed
entry = erp.get(invoice.purchase_order)      # -> ERPEntry | None
# rule 5: entry and entry.status == "PENDIENTE"  (PAGADA => NO_PAGAR / never pay twice)
# cross-check: entry.expected_amount vs invoice.total, entry.supplier_id / tax_id
```

## `ERPEntry`
```
asiento_id, purchase_order, supplier_id, tax_id, expected_amount(Decimal), status, date
```

## Saturday / Sunday
- Batch-2 ERP update: restart the bridge with `--lote2 <csv>`, then re-run
  `python -m src.erp_snapshot`. Upsert means changed rows update in place; new
  rows are added; nothing is duplicated.
- Sunday live datum change: same — just re-snapshot. Idempotent.
- **Note:** "norma v4" is a *rules* change (Person B's engine), NOT an ERP change.

## Observability (for the pitch — traceability points)
Each run logs to `snapshot_runs` and returns stats:
`{requests, pages_fetched, ora_00600_retries, rate_limit_waits, relogins, elapsed_s, errors}`.
