import json
import random
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
outcome_paths = [ROOT / "outcomes.jsonl", ROOT / "outcomes_lote2.jsonl"]
items = []
for outcome_path in outcome_paths:
    with outcome_path.open(encoding="utf-8") as stream:
        items.extend(json.loads(line) for line in stream if line.strip())

# 540 items: an exact 27-column x 20-row rectangle.
# ViewBox: 0 0 660 215
# Centered data area:
# x in [42, 618] -> width = 576
# y in [28, 164] -> height = 136

cols = 27
rows = 20
counts = Counter(item["result"] for item in items)
if len(items) != cols * rows:
    raise SystemExit(f"the cover matrix expects 540 outcomes, found {len(items)}")

x0 = 42.0
y0 = 28.0
dx = 576.0 / (cols - 1)
dy = 136.0 / (rows - 1)

# The cover is an aggregate illustration, not a file-order lookup table. Keep
# exact totals but distribute exception markers across the interior so the
# figure reads cleanly at print size. The seed makes the layout reproducible.
interior = [
    row * cols + col
    for row in range(1, rows - 1)
    for col in range(1, cols - 1)
]
random.Random(540_476_13_51).shuffle(interior)
no_pagar_positions = set(interior[:counts["NO_PAGAR"]])
escalar_positions = set(
    interior[counts["NO_PAGAR"]:counts["NO_PAGAR"] + counts["ESCALAR"]]
)

svg_parts = []
svg_parts.append('<svg viewBox="0 0 660 215" width="100%" height="auto" class="matriz-svg" xmlns="http://www.w3.org/2000/svg">')

# Outer canvas background & fine archival borders
svg_parts.append('<rect x="2" y="2" width="656" height="211" fill="#fcfdfc" stroke="#c9d4ca" stroke-width="0.55"/>')
svg_parts.append('<rect x="5" y="5" width="650" height="205" fill="none" stroke="#e6ede6" stroke-width="0.35"/>')

# Corner crosshairs (+)
corners = [(2, 2), (658, 2), (2, 213), (658, 213)]
for cx, cy in corners:
    svg_parts.append(f'<line x1="{cx-3.5}" y1="{cy}" x2="{cx+3.5}" y2="{cy}" stroke="#4a3c7e" stroke-width="0.5"/>')
    svg_parts.append(f'<line x1="{cx}" y1="{cy-3.5}" x2="{cx}" y2="{cy+3.5}" stroke="#4a3c7e" stroke-width="0.5"/>')

# Archival seal watermark in background
seal_cx = 530
seal_cy = 96
svg_parts.append(f'''
  <g opacity="0.14" stroke="#4a3c7e" fill="none" transform="rotate(-6 {seal_cx} {seal_cy})">
    <circle cx="{seal_cx}" cy="{seal_cy}" r="60" stroke-width="0.75" stroke-dasharray="2.5 1.5"/>
    <circle cx="{seal_cx}" cy="{seal_cy}" r="56.5" stroke-width="0.3"/>
    <circle cx="{seal_cx}" cy="{seal_cy}" r="43" stroke-width="0.5"/>
    <circle cx="{seal_cx}" cy="{seal_cy}" r="40.5" stroke-width="0.25" stroke-dasharray="1 1"/>
    <circle cx="{seal_cx}" cy="{seal_cy}" r="25" stroke-width="0.4"/>
    <path id="seal-path" d="M {seal_cx-50} {seal_cy} A 50 50 0 1 1 {seal_cx+50} {seal_cy} A 50 50 0 1 1 {seal_cx-50} {seal_cy}" fill="none"/>
    <text font-family="'Noto Sans Mono', monospace" font-size="4.6" fill="#4a3c7e" letter-spacing="1.4" text-anchor="middle">
      <textPath href="#seal-path" startOffset="50%">
        * AUDITORIA DETERMINISTA * ELEQUIPO * HACKSPAIN 2026 * EXPEDIENTE FORENSE *
      </textPath>
    </text>
    <text x="{seal_cx}" y="{seal_cy-4}" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="8" fill="#4a3c7e" text-anchor="middle" letter-spacing="0.4">{len(items)}</text>
    <text x="{seal_cx}" y="{seal_cy+5}" font-family="'Noto Sans Mono', monospace" font-size="4.5" fill="#4a3c7e" text-anchor="middle" letter-spacing="0.3">FACTURAS</text>
    <text x="{seal_cx}" y="{seal_cy+12}" font-family="'Noto Sans Mono', monospace" font-size="3.8" fill="#4a3c7e" text-anchor="middle" letter-spacing="0.2">0,00 $ MODELOS</text>
  </g>
''')

# Quiet plotting field: the guides are sparse so all 540 marks remain legible.
svg_parts.append(f'<rect x="{x0-4}" y="{y0-3}" width="584" height="142" fill="#fcfdfc"/>')

# Coordinate ticks and sparse guides aligned to the exact grid.
column_guides = [0, 6, 12, 18, 24, 26]
for c in column_guides:
    x = x0 + c * dx
    svg_parts.append(f'<line x1="{x:.1f}" y1="{y0-3}" x2="{x:.1f}" y2="{y0+136+3}" stroke="#c9d4ca" stroke-width="0.4" stroke-dasharray="1.5 1.5"/>')
    col_num = f"{c+1:02d}"
    svg_parts.append(f'<text x="{x:.1f}" y="{y0-9}" font-family="\'Noto Sans Mono\', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">C{col_num}</text>')

row_guides = [0, 5, 10, 15, 19]
for r in row_guides:
    y = y0 + r * dy
    svg_parts.append(f'<line x1="{x0-3}" y1="{y:.1f}" x2="{x0+576+3}" y2="{y:.1f}" stroke="#c9d4ca" stroke-width="0.4" stroke-dasharray="1.5 1.5"/>')
    row_num = f"{r+1:02d}"
    svg_parts.append(f'<text x="{x0-8}" y="{y+1.8:.1f}" font-family="\'Noto Sans Mono\', monospace" font-size="5.2" fill="#55635b" text-anchor="end">F{row_num}</text>')

# Draw a complete, visually balanced 27 x 20 field. Totals come from the two
# root outcome artifacts; spatial position is deliberately illustrative.
for idx in range(len(items)):
    col = idx % cols
    row = idx // cols
    x = x0 + col * dx
    y = y0 + row * dy
    if idx in no_pagar_positions:
        res = "NO_PAGAR"
    elif idx in escalar_positions:
        res = "ESCALAR"
    else:
        res = "PAGAR"

    if res == "PAGAR":
        svg_parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.65" fill="#256a4a"/>')
    elif res == "NO_PAGAR":
        # Crimson duplicate target
        svg_parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.2" fill="#fcfdfc" stroke="#8f241b" stroke-width="0.75" stroke-dasharray="1 1"/>')
        svg_parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.65" fill="#8f241b"/>')
        svg_parts.append(f'<line x1="{x-3.8:.1f}" y1="{y:.1f}" x2="{x+3.8:.1f}" y2="{y:.1f}" stroke="#8f241b" stroke-width="0.35"/>')
    elif res == "ESCALAR":
        # Amber escalation diamond
        svg_parts.append(f'<rect x="{x-2.15:.1f}" y="{y-2.15:.1f}" width="4.3" height="4.3" transform="rotate(45 {x:.1f} {y:.1f})" fill="#fcfdfc" stroke="#9c6512" stroke-width="0.7"/>')
        svg_parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.0" fill="#9c6512"/>')

# Barrier hairline
svg_parts.append('<line x1="12" y1="184" x2="648" y2="184" stroke="#c9d4ca" stroke-width="0.45"/>')

# Refined legend & filter indicator
def pct(result: str) -> str:
    return f"{counts[result] * 100 / len(items):.1f}".replace(".", ",")


svg_parts.append(f'''
  <g transform="translate(18, 198)">
    <!-- PAGAR glyph -->
    <circle cx="4" cy="-1.5" r="2.2" fill="#256a4a"/>
    <text x="11" y="1.2" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="6.4" fill="#256a4a">{counts['PAGAR']} PAGAR</text>
    <text x="56" y="1.2" font-family="'Noto Sans Mono', monospace" font-size="5.4" fill="#55635b">({pct('PAGAR')} %)</text>

    <!-- NO_PAGAR glyph -->
    <circle cx="120" cy="-1.5" r="4.2" fill="none" stroke="#8f241b" stroke-width="0.75" stroke-dasharray="1 1"/>
    <circle cx="120" cy="-1.5" r="1.8" fill="#8f241b"/>
    <text x="129" y="1.2" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="6.4" fill="#8f241b">{counts['NO_PAGAR']} NO_PAGAR</text>
    <text x="180" y="1.2" font-family="'Noto Sans Mono', monospace" font-size="5.4" fill="#55635b">({pct('NO_PAGAR')} %)</text>

    <!-- ESCALAR glyph -->
    <rect x="238" y="-3.8" width="4.6" height="4.6" transform="rotate(45 240.3 -1.5)" fill="none" stroke="#9c6512" stroke-width="0.75"/>
    <circle cx="240.3" cy="-1.5" r="1.2" fill="#9c6512"/>
    <text x="249" y="1.2" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="6.4" fill="#9c6512">{counts['ESCALAR']} ESCALAR</text>
    <text x="298" y="1.2" font-family="'Noto Sans Mono', monospace" font-size="5.4" fill="#55635b">({pct('ESCALAR')} %)</text>

    <!-- FILTERS BAR -->
    <text x="368" y="1.2" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#4a3c7e" letter-spacing="0.3">
      TAMIZ: [G1 NIF] · [G2 IBAN] · [G3 FECHA] · [G4 IVA] · [G5 PO] · [G6 ERP]
    </text>
  </g>
''')

svg_parts.append('</svg>')

svg_markup = "\n".join(svg_parts)
output_path = ROOT / "tmp" / "matriz_cover.svg"
output_path.parent.mkdir(parents=True, exist_ok=True)
with output_path.open("w", encoding="utf-8") as f:
    f.write(svg_markup)

print("Generated expanded tmp/matriz_cover.svg.")
