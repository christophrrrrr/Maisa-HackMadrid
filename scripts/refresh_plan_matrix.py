"""Replace the cover's inline outcome matrix with the generated SVG."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
plan_path = ROOT / "docs" / "albertitos_plan" / "plan.html"
svg_path = ROOT / "tmp" / "matriz_cover.svg"

html = plan_path.read_text(encoding="utf-8")
svg = svg_path.read_text(encoding="utf-8")
pattern = re.compile(r'<svg\b[^>]*class="matriz-svg"[^>]*>.*?</svg>', re.DOTALL)
updated, replacements = pattern.subn(svg, html, count=1)
if replacements != 1:
    raise SystemExit(f"expected one cover matrix, replaced {replacements}")

plan_path.write_text(updated, encoding="utf-8")
print("Refreshed cover outcome matrix in plan.html")
