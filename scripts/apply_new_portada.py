from pathlib import Path

plan_path = Path("docs/albertitos_plan/plan.html")
html = plan_path.read_text(encoding="utf-8")

# Read SVG
svg_path = Path("tmp/matriz_cover.svg")
svg_content = svg_path.read_text(encoding="utf-8")

new_css = """/* ---------- portada (Geometría Forense) ---------- */
.portada{
  padding:16mm 28mm 14mm 28mm;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  background:var(--papel);
}

.portada-top{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  font-family:var(--forma);
  font-size:7.4pt;
  letter-spacing:.04em;
  color:var(--tinta-suave);
  border-bottom:.8pt solid var(--tinta);
  padding-bottom:2mm;
  margin-bottom:5mm;
  flex:0 0 auto;
}
.portada-top b{ color:var(--tinta); font-weight:700; }
.portada-top .ref-tag{ font-family:var(--dato); font-size:6.8pt; color:var(--sello); }

.portada-hero{
  flex:0 0 auto;
  margin-bottom:5mm;
}
.portada-rubrica{
  font-family:var(--forma);
  font-size:7.2pt;
  font-weight:700;
  letter-spacing:.16em;
  text-transform:uppercase;
  color:var(--sello);
  margin-bottom:2.2mm;
  display:flex;
  align-items:center;
  gap:2.5mm;
}
.portada-rubrica::after{
  content:"";
  flex:1;
  height:.4pt;
  background:var(--pauta);
}

.portada h1{
  font-size:76pt;
  line-height:.84;
  letter-spacing:-.035em;
  margin:0 0 3mm;
  font-weight:700;
  color:var(--tinta);
}
.portada h1 .punto{ color:var(--sello); }

.portada .lema-wrap{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  gap:6mm;
  border-bottom:.4pt solid var(--pauta);
  padding-bottom:2.4mm;
}
.portada .lema{
  font-family:var(--forma);
  font-size:13pt;
  font-weight:700;
  color:var(--tinta);
  letter-spacing:-.01em;
  margin:0;
  white-space:nowrap;
}
.portada .tesis{
  font-family:var(--lectura);
  font-size:8.4pt;
  line-height:1.36;
  color:var(--tinta-suave);
  margin:0;
  max-width:88mm;
  text-align:right;
}

.portada-matriz-box{
  flex:0 0 auto;
  margin:2mm 0 4.5mm;
}
.matriz-header{
  display:flex;
  justify-content:space-between;
  align-items:baseline;
  font-family:var(--dato);
  font-size:6.2pt;
  letter-spacing:.02em;
  color:var(--tinta-suave);
  margin-bottom:1.4mm;
  white-space:nowrap;
}
.matriz-header b{ color:var(--tinta); font-weight:700; font-family:var(--forma); font-size:6.9pt; }
.matriz-header .gate-info{ color:var(--sello); font-family:var(--dato); font-size:6.2pt; }
.matriz-svg{ display:block; width:100%; height:auto; }

.portada-balance{
  flex:0 0 auto;
  margin-top:1.5mm;
}
.portada-barra{
  display:flex;
  height:3.8mm;
  gap:.8mm;
  border-radius:1px;
  overflow:hidden;
  margin-bottom:3.2mm;
}
.portada-barra span{ display:block; }
.portada-barra .b-pagar{ background:var(--pagar); }
.portada-barra .b-nopagar{ background:var(--nopagar); }
.portada-barra .b-escalar{ background:var(--escalar); }

.portada-tripartito{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  column-gap:5mm;
  border-top:.8pt solid var(--tinta);
  border-bottom:.8pt solid var(--pauta);
  padding:3mm 0 3.5mm;
}
.portada-tripartito > div{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  padding-right:2mm;
  min-width:0;
}
.portada-tripartito > div + div{
  border-left:.4pt solid var(--pauta-fina);
  padding-left:4.5mm;
}
.portada-tripartito .cifra-fila{
  display:flex;
  align-items:baseline;
  gap:2.4mm;
}
.portada-tripartito .cifra{
  font-family:var(--forma);
  font-weight:700;
  font-size:26pt;
  line-height:1;
  letter-spacing:-.01em;
  color:var(--tinta);
}
.portada-tripartito .pct{
  font-family:var(--dato);
  font-size:7.6pt;
  color:var(--tinta-suave);
}
.portada-tripartito .v{
  font-size:8.4pt;
  margin-top:1.4mm;
  letter-spacing:.04em;
  white-space:nowrap;
  font-family:var(--forma);
  font-weight:700;
}
.portada-tripartito .euros{
  font-family:var(--dato);
  font-size:8pt;
  color:var(--tinta-suave);
  margin-top:.7mm;
  font-weight:500;
  white-space:nowrap;
}
.portada-tripartito .glosa{
  font-family:var(--lectura);
  font-size:8pt;
  line-height:1.32;
  color:var(--tinta-suave);
  margin-top:1.4mm;
  text-align:left;
  hyphens:auto;
}

.portada-pie{
  border-top:.5pt solid var(--pauta);
  padding-top:2mm;
  margin-top:auto;
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-family:var(--forma);
  font-size:7pt;
  color:var(--tinta-suave);
  flex:0 0 auto;
}
.portada-pie .telemetria{
  display:flex;
  gap:5mm;
  font-family:var(--dato);
  font-size:6.7pt;
  color:var(--tinta);
}
.portada-pie .telemetria span b{
  color:var(--sello);
  font-weight:400;
}
.portada-pie .colofon{
  letter-spacing:.02em;
}"""

# Replace CSS
css_start = html.find("/* ---------- portada (Geometría Forense) ---------- */")
if css_start == -1:
    css_start = html.find("/* ---------- portada")
css_end = html.find("/* ---------- figura de la costura ---------- */")
assert css_start != -1 and css_end != -1, "CSS delimiters not found"
html = html[:css_start] + new_css + "\n\n" + html[css_end:]

# New Portada HTML
new_portada_html = f"""<!-- ============================ 1 · PORTADA ============================ -->
<section class="hoja portada">
  <div class="portada-top">
    <span><b>Elequipo</b> · Maisa HackSpain 2026 · 500 Sombras de Alberto</span>
    <span class="ref-tag">EXPEDIENTE DE AUDITORÍA · REF. HC26-500 · DETERMINISTA</span>
  </div>

  <div class="portada-hero">
    <div class="portada-rubrica">Arquitectura de Reglas Deterministas &amp; Auditoría Forense</div>
    <h1>Cuentas<br>claras<span class="punto">.</span></h1>
    <div class="lema-wrap">
      <p class="lema">Qué facturas pagar, y por qué.</p>
      <p class="tesis">Sistema determinista de seis filtros para quinientas facturas: 452 pagos inmediatos, 11 duplicados detenidos y 37 expedientes con la anomalía identificada para revisión humana.</p>
    </div>
  </div>

  <div class="portada-matriz-box">
    <div class="matriz-header">
      <span><b>FIG. 1 · MATRIZ DETERMINISTA DEL LOTE</b> (500 facturas en retícula 25 × 20)</span>
      <span class="gate-info">2,06 s · 0,00 $ MODELOS · 100 % DETERMINISTA</span>
    </div>
    {svg_content}
  </div>

  <div class="portada-balance">
    <div class="portada-barra">
      <span class="b-pagar" style="flex:452"></span>
      <span class="b-nopagar" style="flex:11"></span>
      <span class="b-escalar" style="flex:37"></span>
    </div>

    <div class="portada-tripartito">
      <div>
        <div class="cifra-fila"><span class="cifra">452</span><span class="pct">90,4 %</span></div>
        <span class="v v-pagar">PAGAR</span>
        <span class="euros">2.450.391,46 €</span>
        <p class="glosa">Las seis reglas pasan limpiamente. Se abonan de forma desatendida sin riesgo operativo.</p>
      </div>
      <div>
        <div class="cifra-fila"><span class="cifra">11</span><span class="pct">2,2 %</span></div>
        <span class="v v-nopagar">NO_PAGAR</span>
        <span class="euros">19.184,92 €</span>
        <p class="glosa">Duplicidad probada frente al ERP o dentro del lote. Capital protegido de inmediato.</p>
      </div>
      <div>
        <div class="cifra-fila"><span class="cifra">37</span><span class="pct">7,4 %</span></div>
        <span class="v v-escalar">ESCALAR</span>
        <span class="euros">144.119,95 €</span>
        <p class="glosa">Discrepancias en IBAN, NIF, fecha o pedido. Expediente aislado con el dato que no cuadra ya señalado.</p>
      </div>
    </div>
  </div>

  <div class="portada-pie">
    <div class="telemetria">
      <span><b>500</b> facturas auditadas</span>
      <span><b>2,06 s</b> tiempo total</span>
      <span><b>0,00 $</b> coste en LLMs</span>
      <span><b>1</b> portátil monoproceso</span>
    </div>
    <span class="colofon">Elequipo · albertitos_plan · 11 páginas de especificación</span>
  </div>
</section>"""

html_start = html.find("<!-- ============================ 1 · PORTADA ============================ -->")
html_end = html.find("<!-- ==================== 2 · EL TRABAJO DE ALBERTO ==================== -->")
assert html_start != -1 and html_end != -1, "HTML delimiters not found"
html = html[:html_start] + new_portada_html + "\n\n" + html[html_end:]

plan_path.write_text(html, encoding="utf-8")
print("Successfully applied refined portada to plan.html")
