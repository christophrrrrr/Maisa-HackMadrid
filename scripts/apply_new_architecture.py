from pathlib import Path

plan_path = Path("docs/albertitos_plan/plan.html")
html = plan_path.read_text(encoding="utf-8")

svg_content = Path("tmp/figura_arquitectura.svg").read_text(encoding="utf-8")

css_add = """/* ---------- figura de la costura (Arquitectura Forense) ---------- */
.costura-wrap{
  width:100%;
  margin:1.5mm auto 2.8mm;
}
.costura-svg{
  display:block;
  width:100%;
  height:auto;
}
"""

# Find CSS
c_start = html.find("/* ---------- figura de la costura")
c_end = html.find("/* ---------- etapas ---------- */")
assert c_start != -1 and c_end != -1, "CSS delimiters for costura not found"

html = html[:c_start] + css_add + "\n" + html[c_end:]

# Find HTML div
div_start = html.find('<div class="costura-wrap">')
if div_start == -1:
    div_start = html.find('<div class="costura">')

next_para = html.find('<p>Esta costura contesta la pregunta')
assert div_start != -1 and next_para != -1, "HTML delimiters for costura div not found"

# Look for closing </div> before next_para
div_end = html.rfind('</div>', div_start, next_para)
assert div_end != -1, "Closing div for costura not found"

replacement_html = f'<div class="costura-wrap">\n{svg_content}\n      </div>'
html = html[:div_start] + replacement_html + html[div_end + 6:]

plan_path.write_text(html, encoding="utf-8")
print("Successfully updated costura figure with latest architectural SVG.")
