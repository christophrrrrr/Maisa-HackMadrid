#!/usr/bin/env python
"""Build a stratified hand-labeling sheet for extraction accuracy.

Selects a sample of processed invoices (spread across every digital template
plus a set of image scans), renders the scan pages to PNGs you can eyeball, and
writes docs/labels/label_sheet.csv with the extractor's output pre-filled and
blank columns for the human verifier.

    python scripts/make_label_sheet.py            # default: 5/template + 15 scans
    python scripts/make_label_sheet.py --per-template 6 --scans 20

Then open docs/labels/label_sheet.csv, compare each row's extracted values
against the source (scans: outputs/label_imgs/<file>.png ; digital: the PDF in
challenge/facturas/), and fill the `wrong_fields` column. Finally run
`python scripts/analyze_extraction.py` to fold the labels into the report.
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "outputs" / "pipeline_state.sqlite"
EXTRACTED = ROOT / "outputs" / "extracted_invoices.jsonl"
FACTURAS = ROOT / "challenge" / "facturas"
IMG_DIR = ROOT / "outputs" / "label_imgs"
OUT_CSV = ROOT / "docs" / "labels" / "label_sheet.csv"

FIELD_KEYS = {
    "po": "purchase_order",
    "nif": "supplier_tax_id",
    "iban": "supplier_iban",
    "date": "issue_date",
    "base": "base",
    "iva": "iva_amount",
    "total": "total",
}
HEADERS = (
    ["file_id", "method", "template", "decision", "reason", "source"]
    + list(FIELD_KEYS)          # extracted values, one column per field
    + ["wrong_fields", "notes"]  # <- labeler fills these
)


def load_templates() -> dict[str, str]:
    tmpl: dict[str, str] = {}
    for line in EXTRACTED.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        tmpl[r["invoice"]["file_id"]] = r.get("template") or "-"
    return tmpl


def render_scan(file_id: str) -> str:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    src = FACTURAS / file_id
    out = IMG_DIR / (file_id + ".png")
    try:
        doc = fitz.open(src)
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72), alpha=False)
        pix.save(str(out))
        doc.close()
        return str(out.relative_to(ROOT)).replace("\\", "/")
    except Exception as e:  # noqa: BLE001
        return f"<render failed: {e}>"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-template", type=int, default=5, help="digital docs per template")
    ap.add_argument("--scans", type=int, default=15, help="number of image scans")
    args = ap.parse_args()

    if not DB.exists():
        raise SystemExit(f"missing {DB} - run the pipeline first")

    tmpl = load_templates()
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM decisions")]
    conn.close()

    digital = defaultdict(list)
    scans = []
    for r in rows:
        m = r["extraction_method"] or "-"
        if m == "embedded_text":
            digital[tmpl.get(r["file_id"], "-")].append(r)
        elif str(m).startswith("vision"):
            scans.append(r)

    sample: list[dict] = []
    for _, lst in sorted(digital.items()):
        sample += sorted(lst, key=lambda x: x["file_id"])[: args.per_template]
    sample += sorted(scans, key=lambda x: x["file_id"])[: args.scans]

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(HEADERS)
        for r in sample:
            method = r["extraction_method"] or "-"
            is_scan = str(method).startswith("vision")
            ex = json.loads(r["extracted"]) if r["extracted"] else {}
            source = render_scan(r["file_id"]) if is_scan else f"challenge/facturas/{r['file_id']}"
            values = [ex.get(FIELD_KEYS[f]) for f in FIELD_KEYS]
            w.writerow(
                [r["file_id"], method, tmpl.get(r["file_id"], "-"), r["result"], r["reason"], source]
                + values
                + ["", ""]
            )

    n_scan = min(len(scans), args.scans)
    print(f"wrote {OUT_CSV.relative_to(ROOT)} with {len(sample)} rows "
          f"({len(sample) - n_scan} digital + {n_scan} scans)")
    print(f"scan images rendered to {IMG_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
