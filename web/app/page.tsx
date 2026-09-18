import Link from "next/link";
import { getState } from "@/lib/python";
import RunButton from "@/components/RunButton";

export const dynamic = "force-dynamic";

function pct(n: number, total: number) {
  return total ? `${Math.round((n / total) * 100)}%` : "0%";
}

export default function Dashboard() {
  const { summary, latest_run, decisions } = getState();
  const stats = (latest_run?.stats && typeof latest_run.stats === "object"
    ? (latest_run.stats as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const lowConf = Number(stats["extractor_low_conf"] ?? 0);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ margin: "0 0 4px" }}>Batch overview</h1>
          <div className="muted" style={{ fontSize: 14 }}>
            {latest_run
              ? `Last run ${new Date(latest_run.started_at).toLocaleString()} · rules ${latest_run.rules_version} · ${latest_run.status}`
              : "No run yet — hit Run batch."}
          </div>
        </div>
        <RunButton />
      </div>

      <div className="grid cards" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="k">Invoices</div>
          <div className="v">{summary.total}</div>
          <div className="sub">{lowConf} low-confidence extraction</div>
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

      <div className="section-title">Operations</div>
      <div className="grid cards">
        <div className="card">
          <div className="k">Throughput</div>
          <div className="v">{latest_run?.files_per_s?.toFixed(1) ?? "—"}<span style={{ fontSize: 14 }}> files/s</span></div>
          <div className="sub">{latest_run?.elapsed_s ? `${latest_run.elapsed_s.toFixed(2)}s total` : ""}</div>
        </div>
        <div className="card">
          <div className="k">Cost</div>
          <div className="v">${(latest_run?.cost_usd ?? 0).toFixed(2)}</div>
          <div className="sub">baseline extractor is free</div>
        </div>
        <div className="card">
          <div className="k">Extractor</div>
          <div className="v" style={{ fontSize: 18 }}>{String(stats["extractor"] ?? "—")}</div>
          <div className="sub">avg {String(stats["avg_latency_ms"] ?? "—")} ms/file</div>
        </div>
        <div className="card">
          <div className="k">Backlog (escalar)</div>
          <div className="v">{summary.ESCALAR}</div>
          <div className="sub">need a human</div>
        </div>
      </div>

      <div className="section-title">Recent decisions</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>File</th><th>Result</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {decisions.slice(0, 12).map((d) => (
              <tr key={d.file_id}>
                <td className="mono"><Link href={`/decisions/${encodeURIComponent(d.file_id)}`}>{d.file_id}</Link></td>
                <td><span className={`pill ${d.result}`}>{d.result}</span></td>
                <td className="mono muted">{d.reason}</td>
              </tr>
            ))}
            {decisions.length === 0 && (
              <tr><td colSpan={3} className="muted" style={{ padding: 18 }}>No decisions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12 }}>
        <Link className="chip" href="/decisions">See all {summary.total} decisions →</Link>
      </div>
    </>
  );
}
