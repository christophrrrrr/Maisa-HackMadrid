# Architecture Decision Records

This directory records the architectural decisions that shape the invoice
processing system. These records explain why a choice was made, which
alternatives were considered, and which trade-offs the team accepted.

## Status

- **Proposed:** under discussion and not yet binding.
- **Accepted:** the current architectural decision.
- **Superseded:** replaced by a newer ADR; retained as historical context.
- **Rejected:** considered but not selected.

Accepted ADRs are not silently rewritten when the architecture changes. Create
a new ADR and link both records through their status fields.

## Records

1. [ADR-0001: Separate extraction from payment decisions](0001-separate-extraction-from-decisions.md)
2. [ADR-0002: Escalate uncertainty rather than guess](0002-escalate-uncertainty.md)
3. [ADR-0003: Use hybrid extraction with cached vision fallback](0003-hybrid-extraction.md)
4. [ADR-0004: Persist processing state in SQLite](0004-persist-state-in-sqlite.md)

The final `albertitos_plan.pdf` should summarize two to five of these records.
Per-invoice evidence and rule results are decision traces, not ADRs, and belong
in the pipeline state and reviewer interface.
