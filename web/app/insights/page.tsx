import { getState } from "@/lib/python";

export const dynamic = "force-dynamic";

function pct(n: number, total: number) {
  return total ? `${Math.round((n / total) * 100)}%` : "0%";
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function Insights() {
  const { summary, latest_run, decisions } = getState();
  const stats = (latest_run?.stats && typeof latest_run.stats === "object"
    ? (latest_run.stats as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const lowConf = Number(stats["extractor_low_conf"] ?? 0);

  return (
    <>
      <div>
        <h1 style={{ margin: "0 0 4px" }}>An{"\u00e1"}lisis</h1>
        <div className="muted" style={{ fontSize: 13 }}>
          {latest_run
            ? `\u00daltima ejecuci\u00f3n: ${fmtWhen(latest_run.started_at)}  -  ${latest_run.rules_version}`
            : "A\u00fan no hay ejecuciones registradas."}
        </div>
      </div>

      <div className="grid cards" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="k">Facturas</div>
          <div className="v">{summary.total}</div>
          <div className="sub">{lowConf} con extracci\u00f3n de baja confianza</div>
        </div>
        <div className="card">
          <div className="k">Pagar</div>
          <div className="v" style={{ color: "var(--pagar)" }}>{summary.PAGAR}</div>
          <div className="sub">{pct(summary.PAGAR, summary.total)}</div>
        </div>
        <div className="card">
          <div className="k">No pagar</div>
          <div className="v" style={{ color: "var(--no_pagar)" }}>{summary.NO_PAGAR}</div>
          <div className="sub">{pct(summary.NO_PAGAR, summary.total)}</div>
        </div>
        <div className="card">
          <div className="k">Escalar</div>
          <div className="v" style={{ color: "var(--escalar)" }}>{summary.ESCALAR}</div>
          <div className="sub">{pct(summary.ESCALAR, summary.total)}</div>
        </div>
      </div>

      {summary.total > 0 && (
        <div className="bar" style={{ marginTop: 16 }}>
          <i className="PAGAR" style={{ width: pct(summary.PAGAR, summary.total) }} />
          <i className="NO_PAGAR" style={{ width: pct(summary.NO_PAGAR, summary.total) }} />
          <i className="ESCALAR" style={{ width: pct(summary.ESCALAR, summary.total) }} />
        </div>
      )}

      <div className="section-title">Rendimiento</div>
      <div className="grid cards">
        <div className="card">
          <div className="k">Capacidad</div>
          <div className="v">{latest_run?.files_per_s?.toFixed(1) ?? "-"}<span style={{ fontSize: 14 }}> arch./s</span></div>
          <div className="sub">{latest_run?.elapsed_s ? `${latest_run.elapsed_s.toFixed(2)} s en total` : ""}</div>
        </div>
        <div className="card">
          <div className="k">Coste</div>
          <div className="v">${(latest_run?.cost_usd ?? 0).toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="k">Extracci\u00f3n</div>
          <div className="v" style={{ fontSize: 18 }}>{String(stats["extractor"] ?? "-")}</div>
          <div className="sub">media {String(stats["avg_latency_ms"] ?? "-")} ms/archivo</div>
        </div>
        <div className="card">
          <div className="k">Pendiente de revisi\u00f3n</div>
          <div className="v">{summary.ESCALAR}</div>
        </div>
      </div>

      <div className="section-title">Decisiones recientes</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Archivo</th><th>Resultado</th><th>Motivo</th></tr>
          </thead>
          <tbody>
            {decisions.slice(0, 12).map((d) => (
              <tr key={d.file_id}>
                <td className="mono">{d.file_id}</td>
                <td><span className={`pill ${d.result}`}>{d.result}</span></td>
                <td className="mono muted">{d.reason}</td>
              </tr>
            ))}
            {decisions.length === 0 && (
              <tr><td colSpan={3} className="muted" style={{ padding: 18 }}>Sin decisiones.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
