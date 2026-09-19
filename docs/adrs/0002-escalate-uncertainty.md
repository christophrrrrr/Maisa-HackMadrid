# ADR-0002: Escalate uncertainty rather than guess

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Team Albertitos

## Context

Automatically paying an uncertain invoice can create financial loss or fraud
exposure. Automatically rejecting every anomaly can also block legitimate
payments. The payment policy explicitly requires human review when there is
reasonable doubt.

The system needs a consistent outcome when extraction is incomplete, reference
data is missing, values disagree, or several findings point toward different
outcomes.

## Alternatives considered

1. Treat every failed check as `NO_PAGAR`.
2. Let a language model resolve ambiguous cases.
3. Return `ESCALAR` for uncertainty and reserve `NO_PAGAR` for definitive
   duplicate-payment conditions.

## Decision

Return `ESCALAR` when a human judgment or data correction is required. This
includes incomplete extraction, unknown suppliers, missing purchase orders,
value mismatches, invalid dates, and unexpected ERP data.

Return `NO_PAGAR` only when the available evidence establishes that payment
would be duplicated: an invoice is already marked as paid or the same purchase
order appears more than once in the batch.

When findings map to different outcomes, use this precedence:

`ESCALAR` > `NO_PAGAR` > `PAGAR`.

The mapping from finding codes to outcomes remains configurable, but every run
records the rules version used.

## Consequences

### Positive

- The system does not invent missing facts or silently accept discrepancies.
- Definitive duplicate-payment cases remain separate from reviewable anomalies.
- Alberto receives a focused review queue instead of opaque automatic failures.
- Outcome policy can evolve without changing individual comparison functions.

### Negative

- Conservative handling may produce a larger manual-review queue.
- Precedence can produce `ESCALAR` even when another finding independently says
  not to pay.
- Useful operation requires the review interface to show exact mismatches and
  source evidence.

## Evidence

- The payment policy says that anomalies should be shown to a human and
  reasonable doubt should be escalated.
- `src/policy.py` contains the configurable finding-to-outcome mapping.
- `src/rules_engine.py` applies the documented precedence and records all
  findings, not only the primary reason.
