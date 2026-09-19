# ADR-0001: Separate extraction from payment decisions

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Team Albertitos

## Context

Invoices arrive in multiple layouts, including image-only documents. Extracting
their fields can therefore require probabilistic vision models. Payment
decisions, however, must remain reproducible, testable, and explainable against
the payment policy, supplier master, purchase orders, and ERP snapshot.

Combining extraction and decision-making in one model call would make it hard to
identify whether an incorrect result came from reading the document or applying
the policy.

## Alternatives considered

1. Ask one language model to read each invoice and make the final decision.
2. Use only template-specific regular expressions for extraction and decisions.
3. Normalize each input into a canonical invoice schema, then apply a separate
   deterministic rules engine.

## Decision

Separate the pipeline into two stages:

1. Extraction converts every supported document into `InvoiceData`.
2. The versioned rules engine evaluates `InvoiceData` against normalized
   business and ERP data.

Only extraction may be probabilistic. Given the same normalized inputs,
reference date, reference snapshots, and rules version, the decision stage must
produce the same outcome.

## Consequences

### Positive

- Extraction and policy failures can be diagnosed independently.
- Payment logic can be covered by deterministic unit tests.
- Extractors and model providers can change without rewriting payment rules.
- The decision trace can show the fields and reference values used by each rule.

### Negative

- The system must maintain a canonical schema between stages.
- Schema changes require coordination across extractors, persistence, and rules.
- A plausible but incorrect extraction can still affect the decision, so source
  evidence and escalation remain necessary.

## Evidence

- The supplied invoices contain several layouts and both digital and scanned
  documents.
- `src/models.py` defines the canonical `InvoiceData` contract.
- `src/rules_engine.py` evaluates that contract without reading invoice files or
  calling a model.
- Rules-engine tests exercise individual decision branches independently of
  extraction.
