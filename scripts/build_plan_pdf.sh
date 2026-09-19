#!/usr/bin/env bash
# Renders docs/albertitos_plan/plan.html to outputs/albertitos_plan.pdf with headless Chromium.
# Usage: scripts/build_plan_pdf.sh [--preview]   (--preview also writes page PNGs to tmp/plan/)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/albertitos_plan/plan.html"
OUT="$ROOT/docs/albertitos_plan/albertitos_plan.pdf"

BROWSER="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}"
[ -n "$BROWSER" ] || { echo "no chromium found; set CHROME=/path/to/chrome" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
"$BROWSER" --headless --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=4000 --print-to-pdf="$OUT" "file://$SRC" 2>/dev/null

echo "$OUT  ($(pdfinfo "$OUT" | awk '/^Pages/{print $2}') pages, $(du -h "$OUT" | cut -f1))"

if [ "${1:-}" = "--preview" ]; then
  rm -rf "$ROOT/tmp/plan"; mkdir -p "$ROOT/tmp/plan"
  pdftoppm -r 100 -png "$OUT" "$ROOT/tmp/plan/p" 2>/dev/null
  echo "previews: tmp/plan/"
fi
