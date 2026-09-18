# Alberto Decision Console (`web/`)

Next.js observability & review console over the Python pipeline. **The backend is
the product; this is the window into it.** Next never touches SQLite directly — it
calls the Python CLI, so there are no native Node DB builds.

## Architecture

```
 Browser ──HTTP──▶ Next.js (app router)
                      │  server components ──exec──▶  python -m src.state json      (reads state)
                      │  /api/run (SSE)   ──spawn──▶  python -m src.pipeline --stream (live run)
                      ▼
                 Python backend (../src) ──▶ outputs/pipeline_state.sqlite + outcomes.jsonl
```

## Run it

```bash
# from repo root, make sure there's state (ERP up + one pipeline run):
python -m src.erp_snapshot          # if not already snapshotted
python -m src.pipeline --today 2026-09-18

# then the console:
cd web
npm install
npm run dev                          # http://localhost:3000
```

The **▶ Run batch** button on the dashboard re-runs the pipeline live over SSE and
refreshes the views when it finishes.

Env overrides: `PYTHON` (python executable), `REPO_ROOT` (defaults to `..`).

## Pages
- `/` dashboard — counts, throughput, cost, extractor, backlog, recent decisions.
- `/decisions` — filterable/searchable table of every decision.
- `/decisions/[fileId]` — one decision traced input → fields → rules → evidence → result.

## Notes
- Runs against the **baseline** extractor today; swaps to Person A's LLM extractor
  by changing `?extractor=` (pipeline `--extractor`) once it lands.
- ESCALAR review console (the +10 bonus) is the natural next screen.
