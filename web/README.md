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
# From the repository root, create the Python environment once:
uv venv
uv pip install -r requirements.txt

# Start the local ERP and keep this terminal open:
.venv/bin/python challenge/alberto_erp.py --rapido
```

In another terminal:

```bash
.venv/bin/python -m src.erp_snapshot --quiet
cd web
npm ci
npm run dev                         # http://localhost:3000
```

The ERP snapshot must exist before processing a batch. If the ERP bridge is
already running and `outputs/erp_snapshot.sqlite` is initialized, the first two
ERP commands can be skipped.

```bash
# Useful health check from the repository root:
.venv/bin/python -c 'from src.erp_snapshot import load_snapshot; print(len(load_snapshot()))'
```

The console automatically uses `<repo>/.venv/bin/python` (or
`<repo>/.venv/Scripts/python.exe` on Windows), resolving it to an absolute path
before spawning the backend. This matters because backend commands run with the
repository root as their working directory; leaving a relative interpreter path
unresolved would make those commands fail with `ENOENT`.

To use a different interpreter, pass an absolute path:

```bash
PYTHON="$(cd .. && pwd)/.venv/bin/python" npm run dev
```

Optionally, create the initial decision state before opening the console:

```bash
# Run from the repository root after creating the ERP snapshot.
.venv/bin/python -m src.pipeline --today 2026-09-18
```

The **▶ Run batch** button on the dashboard re-runs the pipeline live over SSE and
refreshes the views when it finishes.

Env overrides: `PYTHON` (use an absolute path) and `REPO_ROOT` (defaults to the
parent of `web/`).

## Pages
- `/` dashboard — counts, throughput, cost, extractor, backlog, recent decisions.
- `/decisions` — filterable/searchable table of every decision.
- `/decisions/[fileId]` — one decision traced input → fields → rules → evidence → result.

## Notes
- Runs against the **baseline** extractor today; swaps to Person A's LLM extractor
  by changing `?extractor=` (pipeline `--extractor`) once it lands.
- ESCALAR review console (the +10 bonus) is the natural next screen.
