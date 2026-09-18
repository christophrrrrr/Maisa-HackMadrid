# Deliverables & the delivery repo

## What the org actually runs

On **Sunday 10:30 (Madrid)** the org clones a **separate, public GitHub repo**, records the
commit at that time, and runs a **private verifier** over the two JSONL files. They:

- **do not** run our code,
- **do not** see or ask for credentials,
- validate only `file_id` + `result` against a private reference (binary apt/no-apt).

So the delivery repo must **NOT** contain our solution, code, or credentials — only:

```
<delivery-repo>/            (root)
├── outcomes.jsonl
├── outcomes_lote2.jsonl
└── albertitos_plan.pdf
```

> ✅ Action item: create a second, empty public repo for delivery (e.g.
> `la-caja-outcomes`). This repo (`Maisa-HackMadrid`) stays private-ish / for the team and is
> where we build. We copy the 3 finished files into the delivery repo at the end.

## The JSONL contract

One JSON object **per file**, one per line. Only `file_id` and `result` are required;
extra trace fields are allowed and can help the pitch (but the verifier ignores them).

- `file_id` = the **exact PDF filename** (e.g. `factura_5518.pdf`, `FA-2508_consultoría.pdf`).
- `result` ∈ `PAGAR` | `NO_PAGAR` | `ESCALAR`.

```json
{"file_id":"factura_5518.pdf","result":"PAGAR"}
{"file_id":"FA-2508_consultoría.pdf","result":"ESCALAR"}
```

Optional richer form we may emit (verifier ignores extras, judges may love them):

```json
{"file_id":"factura_5518.pdf","result":"PAGAR","reason":"all-rules-pass",
 "evidence":{"pedido":"PO-2026-0132","erp_asiento":"AS-00120","erp_estado":"PENDIENTE"},
 "rules_version":"v3","confidence":0.99,"latency_ms":42,"cost_usd":0.0}
```

**Self-checks before delivery:**
- exactly one line per file in `challenge/facturas/` (batch 1 → `outcomes.jsonl`; batch 2 →
  `outcomes_lote2.jsonl`);
- every `result` is one of the three allowed values;
- every `file_id` exactly matches a real filename (mind accents/encoding);
- valid JSON per line, UTF-8, no trailing junk.

## `albertitos_plan.pdf`

Two required sections (judged for the 35-point "Producto, arquitectura y ADRs" criterion):

1. **Arquitectura** — components, data flow & state, split between agents/models/people,
   how failures are observed and recovered.
2. **ADRs / trade-offs** — **2 to 5** decisions, each with: context, alternatives considered,
   decision, accepted consequences, evidence. Short is fine; the judges will ask about any of
   them. Absence/poor quality doesn't break eligibility but forfeits those 35 points.

## Rubric (100 + 10 bonus) — what to optimize for

| Criterion | Pts | What wins it |
| --- | ---: | --- |
| Producto, arquitectura & ADRs | 35 | clear problem framing, right-sized format, defensible ADRs |
| Trazabilidad & observabilidad | 20 | follow one real decision end-to-end; state, evidence, versions, latency, errors, retries, backlog |
| Escalabilidad & coste | 25 | files/sec, hardware, limits, a cost formula, plan for more volume & new file types |
| Resiliencia & recuperación | 10 | LLM/provider failure story: preserve state, no duplicates, degrade, recover |
| Calidad de ejecución | 10 | clear, proportionate, pleasant to operate |
| **Bonus: extra improvement for Alberto** | +10 | one real, original, implemented & demoed feature beyond the required flow |

Tie-breakers: scalability/cost → resilience → bonus → jury decision. **Accuracy is a gate,
not a score** — but we must pass it to compete.
