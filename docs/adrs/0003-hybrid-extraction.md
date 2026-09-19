# ADR-0003: Use hybrid extraction with cached vision fallback

- **Status:** Accepted
- **Date:** 2026-09-19
- **Owners:** Team Albertitos

## Context

Most supplied PDFs contain embedded text, while some are scans or otherwise
cannot be parsed reliably. Sending every invoice to a vision model would add
latency, cost, and provider dependency. Restricting the system to embedded-text
parsing would leave image-only invoices unprocessed.

Repeated runs and transient provider failures must also avoid paying repeatedly
to extract an unchanged document.

## Alternatives considered

1. Send every invoice to a vision model.
2. Support only deterministic embedded-text extraction.
3. Use embedded text first, vision only when necessary, and cache vision results
   by document content.

## Decision

Use a hybrid extraction path:

1. Parse usable embedded text deterministically.
2. Use vision for documents that cannot be extracted confidently.
3. Validate model output against the canonical invoice schema.
4. Cache successful vision output using the invoice SHA-256 digest.
5. Route vision calls through a configured primary model and fallback models.
6. Mark extraction as unavailable or low confidence and escalate when no safe
   extraction can be produced.

## Consequences

### Positive

- The majority of invoices avoid model cost and provider latency.
- Scanned and image-only documents remain supported.
- Content-addressed caching avoids repeated paid calls for unchanged invoices.
- Model fallbacks reduce dependence on a single provider.
- Provider failure degrades to a visible review outcome rather than an invented
  payment decision.

### Negative

- Two extraction paths must produce the same canonical contract.
- Cache invalidation is necessary when extraction prompts or schemas change.
- Vision availability and pricing still affect scanned-document throughput.
- Embedded-text parsing must recognize multiple invoice layouts.

## Evidence

- The challenge data contains many digital PDFs and a smaller image-only subset.
- `src/invoice_extractor.py` distinguishes embedded text, vision, cached vision,
  and unavailable extraction methods.
- Vision results are keyed by SHA-256 and the extractor accepts fallback model
  configuration.
- Pipeline state records extraction method, latency, confidence, and cost for
  each invoice.
