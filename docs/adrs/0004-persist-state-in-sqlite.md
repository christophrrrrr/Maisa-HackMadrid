# ADR-0004: Persist processing state in SQLite

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Team Albertitos

## Context

The pipeline must expose the current decision for each invoice, retain run
metrics, and support safe reprocessing when rules or source data change. The web
application and Python pipeline also need one consistent source of truth without
requiring external infrastructure for a weekend project.

Flat output files alone do not provide convenient querying, atomic updates, or a
clear distinction between current decisions and historical batch runs.

## Alternatives considered

1. Store only generated JSONL files.
2. Store state in ad hoc JSON files.
3. Use an external database service.
4. Use a local SQLite database owned by the Python pipeline.

## Decision

Use SQLite as the operational state store. Keep:

- one run record for each batch execution, including status, counts, timing,
  throughput, cost, and extractor statistics;
- one current decision per `file_id`, including its run, outcome, findings,
  evidence, rules version, extracted fields, extraction metadata, latency, and
  cost.

The Python layer exclusively owns database access. The web application reads and
mutates state through application endpoints backed by the Python state module.
Reprocessing the same `file_id` replaces its current decision through an upsert,
while run records preserve execution-level context.

JSONL remains the delivery format, not the operational source of truth.

## Consequences

### Positive

- No database server or additional deployment dependency is required.
- Per-invoice decisions and run-level observability are queryable.
- Upserts prevent duplicate current decisions for the same filename.
- The UI and final JSONL can be generated from consistent persisted state.
- Rule or ERP changes can replace current outcomes without appending duplicates.

### Negative

- A single local database is not suitable for concurrent distributed workers.
- The current-decision table does not by itself preserve every historical
  decision version for an invoice.
- Backup and migration become necessary if the system moves beyond one machine.
- Stronger resume semantics would require persisting intermediate extraction and
  per-file processing status before the batch completes.

## Evidence

- `src/state.py` defines separate `runs` and `decisions` tables.
- `decisions.file_id` is a primary key and decision writes use an upsert.
- The persisted run captures counts, elapsed time, throughput, total cost, and
  extractor statistics.
- The Next.js console obtains its state through the Python-owned read interface
  instead of opening SQLite directly.
