# High-craft, minimalist architectural diagram for "La Costura"
# Following canvas-design principles: spatial harmony, no overlapping, 90% visual design.

svg = '''<svg viewBox="0 0 680 180" width="100%" height="auto" class="costura-svg" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="seam-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M 0 1 L 5 3 L 0 5 z" fill="#4a3c7e"/>
    </marker>
    <linearGradient id="prob-stream" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#256a4a" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#4a3c7e" stop-opacity="0.10"/>
    </linearGradient>
  </defs>

  <!-- Outer Architectural Bounding Frame -->
  <rect x="2" y="2" width="676" height="176" fill="#ffffff" stroke="#17211d" stroke-width="0.8"/>
  <rect x="5" y="5" width="670" height="170" fill="none" stroke="#eef2ee" stroke-width="0.4"/>

  <!-- Registration Crosshairs (+) -->
  <g stroke="#4a3c7e" stroke-width="0.55">
    <line x1="2" y1="8" x2="12" y2="8"/><line x1="8" y1="2" x2="8" y2="12"/>
    <line x1="668" y1="8" x2="678" y2="8"/><line x1="672" y1="2" x2="672" y2="12"/>
    <line x1="2" y1="172" x2="12" y2="172"/><line x1="8" y1="168" x2="8" y2="178"/>
    <line x1="668" y1="172" x2="678" y2="172"/><line x1="672" y1="168" x2="672" y2="178"/>
  </g>

  <!-- Top Reference Header -->
  <text x="16" y="16.5" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="7" fill="#17211d" letter-spacing="0.06em">FIG. 2 · LA COSTURA</text>
  <text x="340" y="16.2" font-family="'Noto Sans Mono', monospace" font-size="6" fill="#4a3c7e" text-anchor="middle" letter-spacing="0.08em">CORTAFUEGOS CONTRACTUAL · ADR-0001</text>
  <text x="664" y="16.2" font-family="'Noto Sans Mono', monospace" font-size="5.8" fill="#55635b" text-anchor="end">models.py ↔ rules_engine.py</text>
  <line x1="6" y1="23" x2="674" y2="23" stroke="#c9d4ca" stroke-width="0.5"/>

  <!-- ==================== LEFT HEMISPHERE: PROBABILÍSTICO ==================== -->
  <g transform="translate(20, 26)">
    <!-- Section Labels -->
    <text x="0" y="15" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="7.2" fill="#55635b" letter-spacing="0.12em">LADO PROBABILÍSTICO</text>
    <text x="0" y="32" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="15" fill="#17211d">Extracción</text>
    <text x="0" y="44" font-family="'Noto Sans Mono', monospace" font-size="6.2" fill="#8f241b">único espacio con permiso para fallar</text>

    <!-- Visual Flux Streams -->
    <!-- Digital stream -->
    <text x="0" y="66" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="8.2" fill="#256a4a">471 digitales</text>
    <text x="0" y="75" font-family="'Noto Sans Mono', monospace" font-size="5.8" fill="#55635b">PyMuPDF + regex · 0,00 $</text>
    <path d="M 105 68 C 170 68, 210 95, 255 95" fill="none" stroke="#256a4a" stroke-width="1.6" stroke-dasharray="4 2"/>
    <circle cx="105" cy="68" r="3" fill="#256a4a"/>

    <!-- Scanned stream -->
    <text x="0" y="112" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="8.2" fill="#9c6512">29 escaneados</text>
    <text x="0" y="121" font-family="'Noto Sans Mono', monospace" font-size="5.8" fill="#55635b">Vision LLM + caché SHA-256</text>
    <path d="M 105 114 C 170 114, 210 95, 255 95" fill="none" stroke="#9c6512" stroke-width="1.6" stroke-dasharray="3 2"/>
    <circle cx="105" cy="114" r="3" fill="#9c6512"/>

    <!-- Converged arrow into the Seam -->
    <line x1="255" y1="95" x2="265" y2="95" stroke="#4a3c7e" stroke-width="1.6" marker-end="url(#seam-arrow)"/>
  </g>

  <!-- ==================== CENTRAL SEAM: LA COSTURA ==================== -->
  <g transform="translate(340, 24)">
    <!-- Seam Panel Background -->
    <rect x="-44" y="0" width="88" height="151" fill="#eef2ec" stroke="#4a3c7e" stroke-width="0.8"/>

    <!-- Top Label (clean, without any vertical line cutting through it) -->
    <text x="0" y="14" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="6.4" fill="#4a3c7e" text-anchor="middle" letter-spacing="0.14em">LA COSTURA</text>
    <text x="0" y="23" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">cortafuegos</text>

    <!-- Central Monolith: InvoiceData -->
    <rect x="-38" y="32" width="76" height="28" rx="2" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.2"/>
    <text x="0" y="47" font-family="'Noto Sans Mono', monospace" font-weight="700" font-size="9.5" fill="#4a3c7e" text-anchor="middle">InvoiceData</text>
    <text x="0" y="56" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="5.4" fill="#55635b" text-anchor="middle" letter-spacing="0.08em">7 CAMPOS NORMALIZADOS</text>

    <!-- Suture Line: starts ONLY from the bottom of InvoiceData downwards (no line above) -->
    <line x1="0" y1="60" x2="0" y2="146" stroke="#4a3c7e" stroke-width="1.4"/>

    <!-- Schema Fields Listed Cleanly with Ticks -->
    <g transform="translate(0, 68)" font-family="'Noto Sans Mono', monospace" font-size="5.6" fill="#17211d">
      <!-- 1 nif -->
      <line x1="-32" y1="7" x2="32" y2="7" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="7" r="1.5" fill="#4a3c7e"/>
      <text x="-36" y="9.5" text-anchor="end" fill="#4a3c7e">1 nif</text>

      <!-- 2 iban -->
      <line x1="-32" y1="18" x2="32" y2="18" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="18" r="1.5" fill="#4a3c7e"/>
      <text x="36" y="20.5" text-anchor="start" fill="#4a3c7e">2 iban</text>

      <!-- 3 factura -->
      <line x1="-32" y1="29" x2="32" y2="29" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="29" r="1.5" fill="#4a3c7e"/>
      <text x="-36" y="31.5" text-anchor="end" fill="#4a3c7e">3 num</text>

      <!-- 4 fecha -->
      <line x1="-32" y1="40" x2="32" y2="40" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="40" r="1.5" fill="#4a3c7e"/>
      <text x="36" y="42.5" text-anchor="start" fill="#4a3c7e">4 fecha</text>

      <!-- 5 base -->
      <line x1="-32" y1="51" x2="32" y2="51" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="51" r="1.5" fill="#4a3c7e"/>
      <text x="-36" y="53.5" text-anchor="end" fill="#4a3c7e">5 base</text>

      <!-- 6 iva -->
      <line x1="-32" y1="62" x2="32" y2="62" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="62" r="1.5" fill="#4a3c7e"/>
      <text x="36" y="64.5" text-anchor="start" fill="#4a3c7e">6 iva</text>

      <!-- 7 total -->
      <line x1="-32" y1="73" x2="32" y2="73" stroke="#4a3c7e" stroke-width="0.5" stroke-dasharray="1 2"/>
      <circle cx="0" cy="73" r="1.5" fill="#4a3c7e"/>
      <text x="0" y="79.5" text-anchor="middle" fill="#4a3c7e">7 total (±0,01 €)</text>
    </g>
  </g>

  <!-- ==================== RIGHT HEMISPHERE: DETERMINISTA ==================== -->
  <g transform="translate(398, 26)">
    <!-- Section Labels -->
    <text x="12" y="15" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="7.2" fill="#256a4a" letter-spacing="0.12em">LADO DETERMINISTA</text>
    <text x="12" y="32" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="15" fill="#17211d">Decisión</text>
    <text x="12" y="44" font-family="'Noto Sans Mono', monospace" font-size="6.2" fill="#256a4a">función pura · norma v3 · 0 % alucinación</text>

    <!-- 6 Gates Sieve Pipeline -->
    <g transform="translate(12, 70)">
      <!-- Main pipeline backbone line -->
      <line x1="-12" y1="25" x2="152" y2="25" stroke="#17211d" stroke-width="1.6"/>

      <!-- Gate 1: NIF -->
      <circle cx="16" cy="25" r="7" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.3"/>
      <text x="16" y="27.8" font-family="'Noto Sans Mono', monospace" font-size="6.6" font-weight="700" fill="#4a3c7e" text-anchor="middle">1</text>
      <text x="16" y="42" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">NIF</text>

      <!-- Gate 2: IBAN -->
      <circle cx="42" cy="25" r="7" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.3"/>
      <text x="42" y="27.8" font-family="'Noto Sans Mono', monospace" font-size="6.6" font-weight="700" fill="#4a3c7e" text-anchor="middle">2</text>
      <text x="42" y="42" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">IBAN</text>

      <!-- Gate 3: FECHA -->
      <circle cx="68" cy="25" r="7" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.3"/>
      <text x="68" y="27.8" font-family="'Noto Sans Mono', monospace" font-size="6.6" font-weight="700" fill="#4a3c7e" text-anchor="middle">3</text>
      <text x="68" y="42" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">FECHA</text>

      <!-- Gate 4: IVA -->
      <circle cx="94" cy="25" r="7" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.3"/>
      <text x="94" y="27.8" font-family="'Noto Sans Mono', monospace" font-size="6.6" font-weight="700" fill="#4a3c7e" text-anchor="middle">4</text>
      <text x="94" y="42" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">IVA</text>

      <!-- Gate 5: PO -->
      <circle cx="120" cy="25" r="7" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.3"/>
      <text x="120" y="27.8" font-family="'Noto Sans Mono', monospace" font-size="6.6" font-weight="700" fill="#4a3c7e" text-anchor="middle">5</text>
      <text x="120" y="42" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">PO</text>

      <!-- Gate 6: ERP -->
      <circle cx="146" cy="25" r="7" fill="#ffffff" stroke="#4a3c7e" stroke-width="1.3"/>
      <text x="146" y="27.8" font-family="'Noto Sans Mono', monospace" font-size="6.6" font-weight="700" fill="#4a3c7e" text-anchor="middle">6</text>
      <text x="146" y="42" font-family="'Noto Sans Mono', monospace" font-size="5.2" fill="#55635b" text-anchor="middle">ERP</text>

      <!-- 3 Verdict Outlets -->
      <!-- PAGAR (top) -->
      <path d="M 152 25 C 172 25, 180 5, 194 5" fill="none" stroke="#256a4a" stroke-width="1.6"/>
      <circle cx="198" cy="5" r="3.5" fill="#256a4a"/>
      <text x="206" y="7.5" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="8.8" fill="#256a4a">452 PAGAR</text>
      <text x="206" y="15.5" font-family="'Noto Sans Mono', monospace" font-size="5.8" fill="#55635b">90,4 %</text>

      <!-- NO_PAGAR (middle) -->
      <line x1="152" y1="25" x2="194" y2="25" stroke="#8f241b" stroke-width="1.6"/>
      <circle cx="198" cy="25" r="3.5" fill="#8f241b"/>
      <text x="206" y="27.5" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="8.8" fill="#8f241b">11 NO_PAGAR</text>
      <text x="206" y="35.5" font-family="'Noto Sans Mono', monospace" font-size="5.8" fill="#55635b">2,2 %</text>

      <!-- ESCALAR (bottom) -->
      <path d="M 152 25 C 172 25, 180 45, 194 45" fill="none" stroke="#9c6512" stroke-width="1.6"/>
      <circle cx="198" cy="45" r="3.5" fill="#9c6512"/>
      <text x="206" y="47.5" font-family="'TeX Gyre Heros Cn', sans-serif" font-weight="700" font-size="8.8" fill="#9c6512">37 ESCALAR</text>
      <text x="206" y="55.5" font-family="'Noto Sans Mono', monospace" font-size="5.8" fill="#55635b">7,4 %</text>
    </g>
  </g>
</svg>'''

with open("tmp/figura_arquitectura.svg", "w") as f:
    f.write(svg)

print("Updated tmp/figura_arquitectura.svg without upper vertical line.")
