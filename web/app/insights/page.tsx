import { getPolicy, getState } from "@/lib/python";
import { buildInsights, euros, pctBar, type CountRow, type Tone } from "@/lib/insights";
import type { Policy } from "@/lib/types";

export const dynamic = "force-dynamic";

const L = {
  title: "An\u00e1lisis",
  last: "\u00daltima ejecuci\u00f3n ",
  none: "A\u00fan no hay ejecuciones registradas.",
  stp: "Paso autom\u00e1tico",
  reviewOf: " sin revisi\u00f3n",
  pay: "A pagar",
  blocked: "Bloqueado",
  reviewing: "En revisi\u00f3n",
  invoices: " facturas",
  reasons: "Motivos",
  reasonsSub: "raz\u00f3n principal de cada decisi\u00f3n",
  reasonsEmpty: "Ning\u00fan fallo de regla.",
  findings: "Hallazgos",
  findingsSub: "todas las reglas que dispararon",
  findingsEmpty: "Sin hallazgos.",
  leak: "Doble pago evitado",
  leakSub: " en ya pagadas o pedido duplicado",
  extract: "Revisi\u00f3n por extracci\u00f3n",
  extractSub: " escaladas por lectura incompleta",
  extractNone: "sin facturas en revisi\u00f3n",
  suppliers: "Proveedores",
  supplier: "Proveedor",
  topFinding: "Hallazgo m\u00e1s frecuente",
  nobody: "Nadie en revisi\u00f3n.",
};

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function safePolicy(): Policy | null {
  try {
    return getPolicy();
  } catch {
    return null;
  }
}

function RankList({ rows, empty }: { rows: CountRow[]; empty: string }) {
  const max = rows[0]?.n ?? 0;
  if (rows.length === 0) return <div className="an-empty">{empty}</div>;
  return (
    <div className="rank">
      {rows.map((r) => (
        <div className="rank-row" key={r.code}>
          <div className="rank-top">
            <span className="rank-label" title={r.code}>{r.label}</span>
            <span className="rank-n">{r.n}</span>
          </div>
          <div className="rank-bar">
            <i className={r.tone} style={{ width: pctBar(r.n, max) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function toneClass(t: Tone): string {
  return t === "MIX" ? "" : t;
}

export default function Insights() {
  const { latest_run, decisions } = getState();
  const policy = safePolicy();
  const an = buildInsights(decisions, policy);
  const stats = (latest_run?.stats && typeof latest_run.stats === "object"
    ? (latest_run.stats as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const extractor = String(stats["extractor"] ?? "");
  const latency = stats["avg_latency_ms"];
  const ops = [
    latest_run ? L.last + fmtWhen(latest_run.started_at) : null,
    extractor || null,
    latency != null && latency !== "" ? ("media " + String(latency) + " ms") : null,
    latest_run?.rules_version || null,
  ].filter(Boolean).join("  \u00b7  ");

  return (
    <div>
      <div>
        <h1 style={{ margin: "0 0 4px" }}>{L.title}</h1>
        <div className="muted" style={{ fontSize: 13 }}>
          {ops || L.none}
        </div>
      </div>

      <div className="grid cards" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="k">{L.stp}</div>
          <div className="v">{an.stpPct}%</div>
          <div className="sub">{an.auto} de {an.total}{L.reviewOf}</div>
        </div>
        <div className="card">
          <div className="k">{L.pay}</div>
          <div className={"v money " + toneClass("PAGAR")}>{euros(an.euros.PAGAR)}</div>
          <div className="sub">{an.counts.PAGAR}{L.invoices}</div>
        </div>
        <div className="card">
          <div className="k">{L.blocked}</div>
          <div className={"v money " + toneClass("NO_PAGAR")}>{euros(an.euros.NO_PAGAR)}</div>
          <div className="sub">{an.counts.NO_PAGAR}{L.invoices}</div>
        </div>
        <div className="card">
          <div className="k">{L.reviewing}</div>
          <div className={"v money " + toneClass("ESCALAR")}>{euros(an.euros.ESCALAR)}</div>
          <div className="sub">{an.counts.ESCALAR}{L.invoices}</div>
        </div>
      </div>

      <div className="an-split">
        <div className="card">
          <div className="k">{L.reasons}</div>
          <div className="sub" style={{ marginBottom: 12 }}>{L.reasonsSub}</div>
          <RankList rows={an.reasons} empty={L.reasonsEmpty} />
        </div>
        <div className="card">
          <div className="k">{L.findings}</div>
          <div className="sub" style={{ marginBottom: 12 }}>{L.findingsSub}</div>
          <RankList rows={an.findings} empty={L.findingsEmpty} />
        </div>
      </div>

      <div className="grid cards">
        <div className="card">
          <div className="k">{L.leak}</div>
          <div className="v">{an.leakN}</div>
          <div className="sub">{euros(an.leakEuros)}{L.leakSub}</div>
        </div>
        <div className="card">
          <div className="k">{L.extract}</div>
          <div className="v">{an.counts.ESCALAR ? (an.extractPct + "%") : "-"}</div>
          <div className="sub">
            {an.counts.ESCALAR
              ? (an.extractN + " de " + an.counts.ESCALAR + L.extractSub)
              : L.extractNone}
          </div>
        </div>
      </div>

      <div className="section-title">{L.suppliers}</div>
      <div className="card hist-card">
        <div className="hist-scroll">
          <table className="sup-table">
            <thead>
              <tr>
                <th>{L.supplier}</th>
                <th>NIF</th>
                <th className="hist-num">{L.reviewing}</th>
                <th className="hist-num">Importe</th>
                <th>{L.topFinding}</th>
              </tr>
            </thead>
            <tbody>
              {an.suppliers.map((s) => (
                <tr key={s.key}>
                  <td>{s.name}</td>
                  <td className="mono">{s.nif}</td>
                  <td className="hist-num">{s.escalar}</td>
                  <td className="mono hist-num">{euros(s.euros)}</td>
                  <td className="muted">{s.topFinding}</td>
                </tr>
              ))}
              {an.suppliers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: 18 }}>
                    {L.nobody}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
