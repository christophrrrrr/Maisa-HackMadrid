# Maisa HackMadrid — 500 Sombras de Alberto

Team working repo for the Maisa / HackSpain 2026 track **"500 Sombras de Alberto"**
(18–20 Sep 2026, ETSIT UPM). This is our **solution / collaboration repo** — code, data
and notes all live here.

> ⚠️ **This is NOT the delivery repo.** The org clones a *separate, public* repo on
> Sunday that contains **only** `outcomes.jsonl`, `outcomes_lote2.jsonl` and
> `albertitos_plan.pdf` — no code, no credentials. See [`docs/DELIVERABLES.md`](docs/DELIVERABLES.md).

## The challenge in one paragraph

Alberto gets **500 invoice PDFs**, a **chaotic Excel** and a **legacy 2009 ERP**. For every
invoice we must decide **`PAGAR` / `NO_PAGAR` / `ESCALAR`** by applying the payment rules
(`Norma_Pagos_v3`), cross-checking the supplier master, the purchase orders and the ERP
(the official reconciliation source). On Saturday a **2nd batch (+40 invoices), an ERP update
and rule v4** arrive. The judges score **architecture, traceability, scalability/cost and
resilience** — *not* raw accuracy. Passing the private validation (one correct result per
file) is a **binary eligibility gate** for the prize, worth **0 points** itself.

Full distilled analysis: [`docs/CHALLENGE_NOTES.md`](docs/CHALLENGE_NOTES.md).
Plan & open decisions: [`docs/PLAN.md`](docs/PLAN.md).

## Repo layout

```
Maisa-HackMadrid/
├── README.md               ← you are here
├── docs/
│   ├── PLAN.md             ← architecture options + open decisions + roadmap
│   ├── CHALLENGE_NOTES.md  ← distilled rules, data schemas, gotchas
│   └── DELIVERABLES.md     ← exact output contract + delivery-repo rules
├── challenge/              ← the org's materials, verbatim (DO NOT EDIT)
│   ├── RETO_ORIGINAL.md    ← original challenge README
│   ├── MANUAL_ERP_2009.md  ← ERP bridge manual
│   ├── Makefile            ← make erp / erp-fast / erp-status / erp-login
│   ├── alberto_erp.py      ← the local ERP bridge (run this)
│   ├── FINAL_v7_DEFINITIVO_ahorasi.xlsx  ← supplier master + pedidos + rules (+ junk)
│   └── facturas/           ← 500 invoice PDFs
└── outputs/                ← our generated outcomes.jsonl etc. (gitkept)
```

## Quickstart (any teammate, after cloning)

```bash
# 1. Start the local ERP bridge (needs Python 3.9+, stdlib only)
cd challenge
python alberto_erp.py --rapido        # http://127.0.0.1:8009  (--rapido = no fake latency)

# 2. In another shell, sanity-check it
curl -s http://127.0.0.1:8009/erp/estado
curl -s -X POST http://127.0.0.1:8009/erp/login -d "usuario=alberto" -d "clave=FACTURAS2009"
```

Or open <http://127.0.0.1:8009/> in a browser (user `alberto`, pass `FACTURAS2009`).

### Extract invoices

```bash
uv venv
uv pip install -r requirements.txt
source .venv/bin/activate

# Digital PDFs only; image-only documents are marked for review.
python -m src.invoice_extractor --no-vision

# Full batch through Vercel AI Gateway. Only the 29 image-only PDFs call a model.
export AI_GATEWAY_API_KEY="..."
python -m src.invoice_extractor
```

Alternatively, place the variables in a local `.env` file (ignored by Git); the extractor
loads it automatically. Use `.env.example` as the template.

### Run the web console

After creating `.venv` and installing the Python dependencies as shown above:

```bash
cd web
npm ci
npm run dev
```

Open <http://localhost:3000>. The console detects the repository's `.venv`
automatically, so no `PYTHON` override is needed. This avoids the former `ENOENT`
failure caused by passing a relative interpreter path to backend processes.
`npm run dev` also starts the local ERP, waits for it, refreshes its snapshot and
then starts Next.js. Stopping the command also stops the ERP process it created.
See [`web/README.md`](web/README.md) for state initialization and overrides.

The command writes `outputs/extracted_invoices.jsonl`. Vision results are cached by PDF
content hash under `.cache/invoice_extraction/`, so interrupted or repeated runs do not pay
for the same document twice. The default route is `google/gemini-3-flash`, with
`anthropic/claude-sonnet-4.6` and `openai/gpt-5.4` as Gateway fallbacks. Override them with
`--model`, repeated `--fallback-model`, `AI_GATEWAY_MODEL` or
`AI_GATEWAY_FALLBACK_MODELS`.

Human-verified field corrections live in
`config/manual_extraction_overrides.json`. Each correction is bound to the exact PDF SHA-256,
applied after extraction and recorded as `+human-override` in the decision trace. A changed
PDF fails closed instead of inheriting a stale correction.

#### Share the Gateway key safely

Do not commit the real key. Add `AI_GATEWAY_API_KEY` to the linked Vercel project's
**Development** environment. Every team member can then run:

```bash
vercel link
vercel env run -- .venv/bin/python -m src.invoice_extractor
```

`vercel link` is needed once per clone. `vercel env run` injects the shared variables for
that process without writing the secret into the repository. `.env.example` documents the
expected variable names; `.env` and `.env.*` remain ignored.

## Team

| teamId | (fill in — provided by the org) |
| --- | --- |
| Members | (add names) |

## Key dates (Madrid time)

- **Fri 21:00** — batch 1 (500 PDFs, Excel, ERP) released
- **Sat 18:00** — batch 2 (+40 PDFs), ERP update, rule **v4**, surprise scenario
- **Sun 10:30** — org clones the delivery repo & records the commit → **hard deadline**
