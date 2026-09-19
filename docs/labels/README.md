# Extraction accuracy — hand-labeling

This folder holds the human verification of the extractor's output. It feeds the
"Extraction accuracy" section of [`../EXTRACTION_ANALYSIS.md`](../EXTRACTION_ANALYSIS.md).

## How to label

1. **Generate the sheet** (already done once, re-run to refresh or resize):

   ```bash
   python scripts/make_label_sheet.py            # 5 per template + 15 scans
   python scripts/make_label_sheet.py --per-template 8 --scans 20
   ```

   This writes `label_sheet.csv` and renders scan pages to `outputs/label_imgs/`.

2. **Open `label_sheet.csv`** (Excel, or any editor). Each row is one document.
   The seven field columns (`po, nif, iban, date, base, iva, total`) are the
   values the extractor produced.

3. **Check each row against the source:**
   - **Scans** — open the PNG named in the `source` column
     (`outputs/label_imgs/<file>.png`).
   - **Digital** — open the PDF named in the `source` column
     (`challenge/facturas/<file>`).

4. **Fill the `wrong_fields` column:**
   - All seven correct ? write `none`.
   - Otherwise ? comma-separated list of the wrong field names,
     e.g. `iban,date`.
   - Not reviewed yet ? **leave blank** (blank rows are ignored, not counted).
   - Use `notes` for anything worth remembering (e.g. "IBAN illegible on copy").

5. **Fold the labels back in:**

   ```bash
   python scripts/analyze_extraction.py
   ```

   This recomputes field accuracy and fully-correct rates per method and
   rewrites `../EXTRACTION_ANALYSIS.md`.

## Making it defensible

A single labeler is a spot-check. For team-verified numbers, have a second
person label the same rows independently (copy the sheet to
`label_sheet.<initials>.csv`) and confirm you agree before quoting the figure.
The field vocabulary: `po, nif, iban, date, base, iva, total`.
