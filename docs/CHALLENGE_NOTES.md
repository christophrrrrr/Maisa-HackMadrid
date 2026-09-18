# Challenge notes — distilled analysis

Everything below is derived from reading `challenge/`. This is our shared "source of truth"
for what the data actually looks like, so we don't each re-discover it.

## The decision: PAGAR / NO_PAGAR / ESCALAR

For every file in `challenge/facturas/` we emit exactly **one** result. The rules come from
the Excel sheet **`Norma_Pagos_v3`** (verbatim, translated):

1. **Pay only if** the NIF is in the supplier master **and** the invoice IBAN matches the
   master IBAN.
2. The **pedido must exist**, belong to that supplier, and the invoice amount must equal the
   pedido amount (**tolerance 0.01 €**).
3. **IVA** must be correctly calculated and **total = base + IVA** (same 0.01 € tolerance).
4. The **date** must be valid and **not in the future**.
5. ERP state of the pedido must be **`PENDIENTE`**. **Never pay the same pedido twice.**
6. Any anomaly a human should see → **`ESCALAR` with a reason**. *When in reasonable doubt,
   escalate rather than pay.*

> Interpretation (to confirm during build): all checks pass → `PAGAR`; a hard "must not pay"
> condition (already PAGADA / duplicate pedido / not PENDIENTE) → `NO_PAGAR`; a mismatch or
> anomaly that needs a human (unknown supplier, IBAN/amount/IVA mismatch, unparseable, missing
> pedido) → `ESCALAR`. The exact PAGAR/NO_PAGAR/ESCALAR boundary is the crux and must be
> reasoned carefully — the org validates against a private reference we can't see.

## Data source 1 — the 500 invoice PDFs (`challenge/facturas/`)

Two kinds:

- **Digital PDFs** (≈ most files): have a real text layer, parse cleanly with PyMuPDF/pypdf.
  Fields present:
  ```
  FACTURA
  Factura: 2026/11604    Fecha: 08/01/2026
  Pedido: PO-2026-0096
  Suministros Levante S.L.
  NIF: B46102331
  IBAN: ES21 0049 1500 0512 3456 7890
  Cliente: Banco Miralmar S.A. — CIF: A58231074   ← always the payer, ignore
  Servicio mensual ....... 2.489,99
  Base: 2.489,99
  IVA (21%): 522,90
  TOTAL: 3.012,89
  ```
  Numbers are Spanish format (`.` thousands, `,` decimals). Dates `DD/MM/AAAA`.
- **Scanned / image PDFs** — `scan_*.pdf`, `copia_*.pdf`, `fax_*.pdf`, `reimpresion_*.pdf`:
  **no text layer** (text length 0, one embedded image) → need **OCR or a vision model**.
  This is where the LLM cost / resilience / failure story lives.

**Filenames are messy on purpose** — `file_id` in the output is the **exact filename**. Naming
schemes seen: `YYYY-MM-DD_Pxxx.pdf`, `factura_NNNN.pdf`, `FA-xxxx_categoria.pdf`,
`F26-xxxx_categoria.pdf`, `2026-xxxxx_categoria.pdf`, plus one-offs (`scan_`, `copia_`, `fax_`,
`reimpresion_`). Some suppliers in invoices are **not** in the master (e.g.
`FA-2508_consultoría.pdf` → "Consultoría Estratégica Ibérica S.L.", pedido `PO-2026-9999` — an
unknown supplier + non-existent pedido → almost certainly `ESCALAR`/`NO_PAGAR`).

## Data source 2 — the Excel (`FINAL_v7_DEFINITIVO_ahorasi.xlsx`)

Deliberately chaotic (14 sheets). **Only 3 matter**; the rest is noise/traps:

| Sheet | Use | Columns |
| --- | --- | --- |
| **`Proveedores`** | supplier master | `ID, Razon Social, NIF, IBAN, Ciudad, Condiciones` — 11 suppliers P001–P011. **`P007` is duplicated** (data-quality trap). |
| **`Pedidos_2026`** | purchase orders | `Pedido, ProveedorID, NIF, Importe_Total, Estado, Fecha_Pedido` — ~516 rows, all `ABIERTO` here (ERP state is the authoritative one). |
| **`Norma_Pagos_v3`** | the rules | the 6 rules above. |
| `Pedidos_2025_OLD`, `NO_TOCAR`, `backup_marzo`, `Hoja1`, `Hoja1 (2)`, `notas_alberto`, `pendiente_revisar`, `MACROS_ROTAS`, `v6_deprecated`, `tablas_dinamicas`, `Sheet3` | **ignore** — junk, notes, broken macros, `#REF!`. |

Encoding note: accents come through as mojibake with some readers (`Ofimática` → `Ofim�tica`);
match suppliers by **ID/NIF/IBAN**, not by razón social string.

## Data source 3 — the legacy ERP bridge (`alberto_erp.py`)

**The authoritative reconciliation source** (per the manual). Runs locally, stdlib only.

- Start: `python alberto_erp.py` (port 8009) or `--rapido` (no artificial 0.12s latency) or
  `--puerto 8010`. Saturday update: `--lote2 path/to/erp_export_lote2.csv`.
- Auth: `POST /erp/login` (`usuario=alberto`, `clave=FACTURAS2009`) → XML token. Token in
  header `X-ERP-Token` or `?token=`. **Sessions expire after 15 min or 300 uses** → on
  `SES-401`, re-login.
- Read: `GET /erp/asientos?pagina=N` — **20 per page** (26 pages for batch 1), `<meta>` has
  `total`/`paginas`. `GET /erp/asientos/AS-00412` for one. `GET /erp/estado` (no auth).
- **Everything is XML in ISO-8859-1**, dates `DD/MM/AAAA`, amounts `12.874,40`.
- Each asiento: `id, fecha, proveedor, nif, pedido, importe, estado` where
  `estado ∈ {PENDIENTE, PAGADA}`. Batch 1 = **516 asientos, 507 PENDIENTE / 9 PAGADA**.
- **Failure modes baked in** (this is the resilience story):
  - `ORA-00600` (HTTP 500) on **every 10th authenticated call** → **retry the same call**.
  - `ERP-429` (HTTP 429) if > 10 req/s → wait `Retry-After`.
  - `SES-401` expired session → re-login.
  - `ERP-400` bad page, `ERP-404` unknown asiento.
- Manual's explicit advice: **download all asientos once, cache locally, work offline.** Do
  this — don't hit the bridge per-invoice.

## How the sources join

```
invoice PDF ──parse──▶ {factura, pedido, nif, iban, base, iva, total, fecha}
                               │
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                           ▼
  Proveedores(Excel)     Pedidos_2026(Excel)          ERP asientos (authoritative)
  match by NIF/ID        pedido exists, belongs,       estado PENDIENTE? already PAGADA?
  IBAN matches?          importe matches?              importe_esperado matches? dup?
        └──────────────────────┴───────────────────────────┘
                               ▼
                    apply Norma v3 → PAGAR / NO_PAGAR / ESCALAR (+ reason & evidence)
```

## Batch 2 / v4 (Saturday) — design for this now

- +40 new invoices (same output contract → `outcomes_lote2.jsonl`).
- ERP update loaded via `--lote2 …csv` (merges: updates existing asientos, adds new).
- **Rule v4** (unknown until Saturday) — keep the rule set **versioned & swappable** so we can
  add/replace a rule and **reprocess incrementally** without touching extraction.
- Sunday: Alberto may change one ERP datum to prove the demo re-runs live → our state must be
  re-derivable and idempotent (same file_id ⇒ same slot, no duplicates).

## Open questions to resolve with the data (during build)

- Rule 2: "invoice amount = pedido amount" — is it **TOTAL** or **base** that must match the
  pedido `Importe_Total`? (Pedidos importes look like gross totals — verify against examples.)
- Does "not in the future" mean vs. the current date, or vs. some fixed reference date?
- Duplicate-pedido detection: across the 500 invoices, across ERP `PAGADA`, or both?
- Which mismatches are `NO_PAGAR` vs `ESCALAR`? (Rule 6 biases toward ESCALAR on doubt.)
