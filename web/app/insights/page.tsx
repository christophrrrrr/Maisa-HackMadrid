import { getPolicyOrNull, getState } from "@/lib/python";
import { buildInsights, euros, pctBar, runOps, usd, type CountRow, type Tone } from "@/lib/insights";

export const dynamic = "force-dynamic";

const L = {
  title: "Análisis",
  last: "Última ejecución ",
  none: "Aún no hay ejecuciones registradas.",
  stp: "Paso automático",
  reviewOf: " sin revisión",
  pay: "A pagar",
  blocked: "Bloqueado",
  reviewing: "En revisión",
  invoices: " facturas",
  findings: "Hallazgos",
  findingsSub: "todas las reglas que dispararon",
  findingsEmpty: "Sin hallazgos.",
  leak: "Doble pago evitado",
  leakSub: " en ya pagadas o pedido duplicado",
  extract: "Revisión por extracción",
  extractSub: " escaladas por lectura incompleta",
  extractNone: "sin facturas en revisión",
  cost: "Coste",
  costFree: "sin coste de API",
  costPaid: " llamadas de pago",
  costGemini: " vision · Gemini / cache sin coste",
  speed: "Velocidad",
  speedNone: "sin ejecución",
  speedFiles: " facturas en ",
};

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRate(n: number) {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " /s";
}

function fmtSec(n: number) {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " s";
}

function fmtMs(n: number) {
  return Math.round(n).toLocaleString("es-ES") + " ms";
}

function RankList({ rows, empty }: { rows: CountRow[]; empty: string }) {
  const max = rows[0]?.n ?? 0;
  if (rows.length === 0) return <div className="an-empty">{empty}</div>;
  return (
    <div className="rank">
      {rows.map((r) => (
        <div className="rank-row" key={r.code}>
          <div className="rank-top">
            <span className="rank-label" title={r.label}>{r.label}</span>
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
  const policy = getPolicyOrNull();
  const an = buildInsights(decisions, policy);
  const opsRun = runOps(latest_run, decisions);
  const stats = (latest_run?.stats && typeof latest_run.stats === "object"
    ? (latest_run.stats as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const extractor = String(stats["extractor"] ?? "");
  const ops = [
    latest_run ? L.last + fmtWhen(latest_run.started_at) : null,
    extractor || null,
    latest_run?.rules_version || null,
  ].filter(Boolean).join("  ·  ");

  const costSub = !opsRun
    ? L.speedNone
    : opsRun.costUsd > 0
      ? (opsRun.nPaid + L.costPaid)
      : opsRun.nVision
        ? (opsRun.nVision + L.costGemini)
        : L.costFree;

  const speedValue = !opsRun
    ? "-"
    : opsRun.filesPerS != null
      ? fmtRate(opsRun.filesPerS)
      : opsRun.elapsedS != null
        ? fmtSec(opsRun.elapsedS)
        : "-";

  const speedSub = !opsRun
    ? L.speedNone
    : [
        opsRun.nFiles
          ? (opsRun.nFiles + L.speedFiles + (opsRun.elapsedS != null ? fmtSec(opsRun.elapsedS) : "-"))
          : null,
        opsRun.avgLatencyMs != null ? ("media " + fmtMs(opsRun.avgLatencyMs)) : null,
      ].filter(Boolean).join(" · ") || L.speedNone;

  return (
    <div>
      <div>
        <h1 style={{ margin: "0 0 4px" }}>{L.title}</h1>
        <div className="subtitle">
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
          <div className="k">{L.findings}</div>
          <div className="sub" style={{ marginBottom: 12 }}>{L.findingsSub}</div>
          <RankList rows={an.findings} empty={L.findingsEmpty} />
        </div>
        <div className="an-stack">
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
        <div className="an-stack">
          <div className="card">
            <div className="k">{L.cost}</div>
            <div className="v">{opsRun ? usd(opsRun.costUsd) : "-"}</div>
            <div className="sub">{costSub}</div>
          </div>
          <div className="card">
            <div className="k">{L.speed}</div>
            <div className="v">{speedValue}</div>
            <div className="sub">{speedSub}</div>
          </div>
        </div>
      </div>

    </div>
  );
}
