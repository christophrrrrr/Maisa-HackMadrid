import BatchFilter from "@/components/BatchFilter";
import { findingColor } from "@/lib/finding-colors";
import { getHistory, getPolicyOrNull, getState } from "@/lib/python";
import { buildInsights, euros, runOps, usd, type CountRow, type RunOps, type Tone } from "@/lib/insights";
import type { Decision, RunRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const L = {
  title: "An\u00e1lisis",
  last: "Ejecuci\u00f3n ",
  all: "Todos los lotes",
  batches: " ejecuciones",
  none: "A\u00fan no hay ejecuciones registradas.",
  stp: "Paso autom\u00e1tico",
  reviewOf: " sin revisi\u00f3n",
  pay: "A pagar",
  blocked: "Bloqueado",
  reviewing: "En revisi\u00f3n",
  invoices: " facturas",
  findings: "Hallazgos",
  findingsEmpty: "Sin hallazgos.",
  leak: "Doble pago evitado",
  leakSub: "facturas ya pagadas o con un pedido duplicado",
  extractionQuality: "Calidad de extracci\u00f3n",
  extractionCorrect: " extra\u00eddas correctamente",
  extractionNone: "sin facturas procesadas",
  cost: "Coste",
  costFree: "sin coste de API",
  costPaid: " llamadas de pago",
  costGemini: " vision \u00b7 Gemini / cache sin coste",
  speed: "Velocidad",
  speedNone: "sin ejecuci\u00f3n",
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

function aggregateOps(runs: RunRow[], decisions: Decision[]): RunOps | null {
  const values = runs
    .map((run) => runOps(run, decisions))
    .filter((value): value is RunOps => value !== null);
  if (!values.length) return null;

  const elapsedS = values.reduce((sum, value) => sum + (value.elapsedS ?? 0), 0);
  const nFiles = values.reduce((sum, value) => sum + value.nFiles, 0);
  const latencyRows = values.filter((value) => value.avgLatencyMs != null && value.nFiles > 0);
  const latencyFiles = latencyRows.reduce((sum, value) => sum + value.nFiles, 0);

  return {
    costUsd: values.reduce((sum, value) => sum + value.costUsd, 0),
    nVision: values.reduce((sum, value) => sum + value.nVision, 0),
    nPaid: values.reduce((sum, value) => sum + value.nPaid, 0),
    nFiles,
    filesPerS: elapsedS > 0 ? nFiles / elapsedS : null,
    elapsedS: elapsedS || null,
    avgLatencyMs: latencyFiles
      ? latencyRows.reduce((sum, value) => sum + value.avgLatencyMs! * value.nFiles, 0) / latencyFiles
      : null,
  };
}

function Sparkline({
  values,
  xLabels,
  label,
  format,
}: {
  values: number[];
  xLabels: string[];
  label: string;
  format: (value: number) => string;
}) {
  if (!values.length) return <span className="spark-empty">&mdash;</span>;
  const width = 240;
  const height = 46;
  const left = 38;
  const right = 4;
  const top = 4;
  const bottom = 13;
  const min = 0;
  const maxValue = Math.max(0, ...values);
  const max = Math.max(1, maxValue);
  const range = max - min;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? (left + width - right) / 2 : left + (index / (values.length - 1)) * (width - left - right);
    const y = range ? top + ((max - value) / range) * (height - top - bottom) : (top + height - bottom) / 2;
    return { x, y, value };
  });

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${values.map(format).join(", ")}`}>
      <line className="spark-axis" x1={left} y1={top} x2={left} y2={height - bottom} />
      <line className="spark-axis" x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
      {maxValue > 0 ? (
        <>
          <text x={left - 4} y={top + 3} textAnchor="end">{format(maxValue)}</text>
          <text x={left - 4} y={height - bottom + 2} textAnchor="end">{format(min)}</text>
        </>
      ) : (
        <text x={left - 4} y={height - bottom + 2} textAnchor="end">{format(0)}</text>
      )}
      <text x={left} y={height - 2} textAnchor="start">{xLabels[0]}</text>
      <text x={width - right} y={height - 2} textAnchor="end">{xLabels[xLabels.length - 1]}</text>
      <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} />
      {points.map(({ x, y, value }, index) => (
        <circle cx={x} cy={y} r="2" key={index}>
          <title>{format(value)}</title>
        </circle>
      ))}
    </svg>
  );
}

function FindingBarChart({ rows, empty }: { rows: CountRow[]; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.n));
  if (rows.length === 0) return <div className="an-empty">{empty}</div>;
  return (
    <div
      className="finding-bars"
      role="img"
      aria-label={rows.map((row) => `${row.label}: ${row.n}`).join(", ")}
    >
      <div
        className="finding-bars-grid"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((row) => (
          <div className="finding-bar-column" key={row.code} title={`${row.label}: ${row.n}`}>
            <span className="finding-bar-count">{row.n}</span>
            <div className="finding-bar-track">
              <i
                style={{
                  height: `${Math.max(4, (row.n / max) * 100)}%`,
                  backgroundColor: findingColor(row.code),
                }}
              />
            </div>
            <span className="finding-bar-label">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function toneClass(t: Tone): string {
  return t === "MIX" ? "" : t;
}

export default function Insights({
  searchParams,
}: {
  searchParams?: { run?: string | string[] };
}) {
  const { recent_runs } = getState();
  const requestedRun = typeof searchParams?.run === "string" ? searchParams.run : "all";
  const activeRun = recent_runs.find((run) => run.run_id === requestedRun) ?? null;
  const selectedRunId = activeRun?.run_id ?? "all";
  const allDecisions = getHistory({ limit: 50000 });
  const decisions = activeRun
    ? allDecisions.filter((decision) => decision.run_id === activeRun.run_id)
    : allDecisions;
  const policy = getPolicyOrNull();
  const an = buildInsights(decisions, policy);
  const opsRun = activeRun
    ? runOps(activeRun, decisions)
    : aggregateOps(recent_runs, allDecisions);
  const stats = (activeRun?.stats && typeof activeRun.stats === "object"
    ? (activeRun.stats as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const extractor = String(stats["extractor"] ?? "");
  const ops = [
    activeRun ? L.last + fmtWhen(activeRun.started_at) : recent_runs.length ? L.all + " \u00b7 " + recent_runs.length + L.batches : null,
    extractor || null,
    activeRun?.rules_version || null,
  ].filter(Boolean).join("  \u00b7  ");

  const decisionsByRun = new Map<string, Decision[]>();
  for (const decision of allDecisions) {
    const rows = decisionsByRun.get(decision.run_id) ?? [];
    rows.push(decision);
    decisionsByRun.set(decision.run_id, rows);
  }
  const trends = recent_runs.slice(0, 12).reverse().map((run) => {
    const rows = decisionsByRun.get(run.run_id) ?? [];
    const insight = buildInsights(rows, policy);
    const runOperation = runOps(run, rows);
    return {
      cost: runOperation?.costUsd ?? 0,
      speed: runOperation?.filesPerS
        ?? (runOperation?.elapsedS ? runOperation.nFiles / runOperation.elapsedS : 0),
      leak: insight.leakN,
      extractionQuality: rows.length
        ? Math.round((rows.filter((decision) => decision.extraction_ok).length / rows.length) * 100)
        : 0,
      label: new Date(run.started_at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
    };
  });
  const trendLabels = trends.map((trend) => trend.label);
  const batchNumbers = new Map(
    [...recent_runs]
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((run, index) => [run.run_id, index + 1]),
  );
  const extractionOk = decisions.filter((decision) => decision.extraction_ok).length;
  const extractionQuality = decisions.length
    ? Math.round((extractionOk / decisions.length) * 100)
    : 0;

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
      ].filter(Boolean).join(" \u00b7 ") || L.speedNone;

  return (
    <div>
      <div className="an-head">
        <div>
          <h1 style={{ margin: "0 0 4px" }}>{L.title}</h1>
          <div className="subtitle">
            {ops || L.none}
          </div>
        </div>
        <BatchFilter
          value={selectedRunId}
          options={recent_runs.map((run) => ({
            runId: run.run_id,
            label: `Lote ${batchNumbers.get(run.run_id)} \u00b7 ${fmtWhen(run.started_at)} \u00b7 ${run.total} factura${run.total === 1 ? "" : "s"}`,
          }))}
        />
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
        <div className="card analysis-findings-card">
          <div className="k">{L.findings}</div>
          <FindingBarChart rows={an.findings} empty={L.findingsEmpty} />
        </div>
        <div className="an-stack">
          <div className="card">
            <div className="k">{L.leak}</div>
            <div className="an-metric">
              <div>
                <div className="v">{an.leakN}</div>
                <div className="sub">{L.leakSub}</div>
              </div>
              {!activeRun && (
                <Sparkline values={trends.map((trend) => trend.leak)} xLabels={trendLabels} label={L.leak} format={(value) => String(value)} />
              )}
            </div>
          </div>
          <div className="card">
            <div className="k">{L.extractionQuality}</div>
            <div className="an-metric">
              <div>
                <div className="v">{decisions.length ? `${extractionQuality}%` : "-"}</div>
                <div className="sub">
                  {decisions.length
                    ? `${extractionOk} de ${decisions.length}${L.extractionCorrect}`
                    : L.extractionNone}
                </div>
              </div>
              {!activeRun && (
                <Sparkline values={trends.map((trend) => trend.extractionQuality)} xLabels={trendLabels} label={L.extractionQuality} format={(value) => `${value}%`} />
              )}
            </div>
          </div>
        </div>
        <div className="an-stack">
          <div className="card">
            <div className="k">{L.cost}</div>
            <div className="an-metric">
              <div>
                <div className="v">{opsRun ? usd(opsRun.costUsd) : "-"}</div>
                <div className="sub">{costSub}</div>
              </div>
              {!activeRun && (
                <Sparkline values={trends.map((trend) => trend.cost)} xLabels={trendLabels} label={L.cost} format={usd} />
              )}
            </div>
          </div>
          <div className="card">
            <div className="k">{L.speed}</div>
            <div className="an-metric">
              <div>
                <div className="v">{speedValue}</div>
                <div className="sub">{speedSub}</div>
              </div>
              {!activeRun && (
                <Sparkline values={trends.map((trend) => trend.speed)} xLabels={trendLabels} label={L.speed} format={fmtRate} />
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
