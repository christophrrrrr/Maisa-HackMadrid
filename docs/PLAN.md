# Plan — 500 Sombras de Alberto

Status: **draft for team review.** Nothing here is locked yet. This doc frames the problem,
lays out the architecture options and the open decisions, and proposes a roadmap. We decide
together before writing code.

## 1. What "winning" means here

The judges reward **engineering judgment**, not accuracy:
architecture/ADRs (35) + traceability (20) + scale/cost (25) + resilience (10) + execution (10)
+ bonus (10). Passing the private validation (one correct result per file) is a **binary gate**
worth 0 points — but we must pass it to be eligible. So:

> **Two goals, in order:** (1) an architecture that is *auditable, scalable and resilient* and
> that we can defend; (2) decisions correct enough to pass the gate.

A small, well-reasoned backend beats a big app with no criteria (the README says so explicitly).

## 2. Proposed architecture (a shape to react to)

A **pipeline** with a clean split between *extraction* (messy, probabilistic, where LLMs earn
their keep) and *decision* (deterministic, auditable, cheap):

```
                ┌────────────────────────────────────────────────────────────┐
                │                    orchestrator / job queue                  │
                │   idempotent per file_id · persists state · resumable        │
                └───────────────┬────────────────────────────┬───────────────┘
                                │                            │
  1. INGEST                     ▼                            ▼            5. EMIT
  list facturas/  ─▶  2. EXTRACT (per file)      3. REFERENCE DATA (once)   outcomes.jsonl
                      digital PDF → parse        Excel master + pedidos     + rich trace log
                      scan/image → OCR/vision    ERP snapshot (cached)      + run manifest
                            │                            │
                            └──────────┬─────────────────┘
                                       ▼
                             4. DECIDE (deterministic)
                             apply Norma vN → PAGAR/NO_PAGAR/ESCALAR
                             + reason code + evidence refs
```

Component notes:

- **Extraction** is the only place we spend LLM/compute. Digital PDFs → deterministic parse
  (PyMuPDF + regex), ~free and exact. Scans → OCR (Tesseract) and/or a **vision LLM** (Claude)
  fallback. This isolates cost and the provider-failure blast radius to one layer.
- **Reference data** loaded **once** and cached: clean the 3 Excel sheets; snapshot **all** ERP
  asientos to a local store (SQLite/parquet), handling `ORA-00600` retries, session renewal and
  rate limits. Everything downstream reads the cache → fast, offline, cheap.
- **Decision** is a **pure function** of (extracted invoice, reference snapshot, rule version).
  Deterministic ⇒ reproducible ⇒ trivially traceable and testable. Rules are **versioned**
  (v3 now, v4 Saturday) and swappable.
- **State** in SQLite keyed by `file_id`: input hash, extracted fields, decision, reason,
  evidence, rule version, latency, cost, retries, status. Gives us idempotency, resume,
  incremental reprocessing, and the entire observability story for free.

### Where the "hybrid" decision fits (our current lean)

Per team call: **hybrid**, most likely as —
- deterministic rules decide the clear-cut majority;
- an LLM is used for **extraction of hard/scanned docs** and, optionally, to **adjudicate a
  narrow band of ambiguous cases** the rules flag as borderline (with its reasoning logged as
  evidence, never as an unauditable black box).

This keeps the decision defensible while still showing genuine agentic use. **Not locked** —
see Open Decisions.

## 3. How this maps to the rubric (why this shape)

| Criterion | How the design earns it |
| --- | --- |
| Architecture/ADRs | clean extraction↔decision split; versioned rules; ADRs write themselves |
| Traceability | per-file row: input hash → fields → rules fired → evidence → decision → latency/cost/retries; "follow one decision" is a single query |
| Scale/cost | digital parse is ~free; only scans cost LLM $; batch + cache ERP; cost formula = f(#scans × vision price) + near-zero rest; measurable files/sec |
| Resilience | LLM down → OCR fallback or queue+retry or ESCALAR("extraction unavailable"); ERP `ORA-00600`/429/401 → retry/backoff/re-login; state persisted ⇒ resume, no dup |
| Execution | one CLI command runs the batch; readable trace output |
| Bonus (+10) | candidates below |

## 4. Bonus ideas (+10) — pick one, implement, demo

- **Reviewer console** for `ESCALAR` items: shows the invoice, the failed rule, the evidence,
  and an approve/override that feeds back — turns escalations into a real workflow for Alberto.
- **"What changed" diff** for Saturday's reprocess: which decisions flipped and *why* when v4 /
  the ERP update landed.
- **Anomaly/spend dashboard**: duplicates caught, escalation reasons histogram, € at risk.
- **Cost & throughput live meter** during the batch run.

## 5. Open decisions (decide as a team)

1. **Language/stack** — Python leans favourite (ERP is Python; pandas/openpyxl/PyMuPDF/OCR/Claude
   all ready). Not locked.
2. **Decision engine** — hybrid (current lean) vs pure-deterministic vs LLM-decides. Settle the
   *exact* role of the LLM in the decision.
3. **Scan extraction** — Tesseract OCR vs Claude vision vs both (vision as fallback). Trade cost
   vs accuracy vs resilience.
4. **State store** — SQLite (recommended, zero-setup, queryable) vs flat files/JSON.
5. **Primary format** — CLI batch runner (simplest, most defensible) vs backend service vs web
   app. Bonus feature may add a thin UI.
6. **Rule interpretation** — resolve the open questions in `CHALLENGE_NOTES.md` §"Open questions"
   against real invoice/pedido examples before trusting the engine.

## 6. Proposed roadmap (once decisions are made)

- **M0 — repo & alignment** ✅ (this repo, notes, plan).
- **M1 — reference layer:** load & clean Excel; ERP snapshot client (login, paginate all,
  retry `ORA-00600`, handle 401/429) → local cache. *Deliver: a queryable snapshot + tests.*
- **M2 — extraction layer:** digital-PDF parser for all fields; verify against a handful of
  invoices. *Deliver: parsed records for the non-scan majority.*
- **M3 — decision engine:** implement Norma v3 as versioned pure functions + reason codes +
  evidence; unit tests on hand-checked cases. *Deliver: `outcomes.jsonl` for digital invoices.*
- **M4 — scans:** OCR/vision fallback for image PDFs. *Deliver: full 500 covered.*
- **M5 — observability & resilience:** state store, trace log, run manifest, failure handling
  drill (kill the LLM / the ERP mid-run and recover).
- **M6 — batch 2 / v4 (Saturday):** wire `--lote2`, add rule v4, incremental reprocess,
  produce `outcomes_lote2.jsonl`; capture the "what changed" story.
- **M7 — bonus feature + `albertitos_plan.pdf` + pitch rehearsal.**
- **M8 — delivery:** create the separate public delivery repo with the 3 files; verify contract;
  commit before **Sun 10:30**.

## 7. Risks / watch-outs

- **Filenames are the id** — mind accents/encoding when writing `file_id` (must match byte-for-byte).
- **ERP is the truth**, not the Excel `Estado` (all `ABIERTO` in Excel; real state is in ERP).
- **Duplicate P007** in the master, junk sheets, mojibake — match on ID/NIF/IBAN, not names.
- **Don't over-hit the ERP** — snapshot once; per-invoice calls will hit rate limits and waste time.
- **Reserve real time** for validating both batches and rehearsing the defense (judges probe ADRs).
- **Never commit credentials** to the delivery repo (they're in the manual anyway, but keep our
  hygiene clean).
