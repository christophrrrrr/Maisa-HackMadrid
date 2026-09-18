import Link from "next/link";
import { getDecision } from "@/lib/python";

export const dynamic = "force-dynamic";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className="mono">{v}</div>
    </>
  );
}

export default function DecisionDetail({ params }: { params: { fileId: string } }) {
  const fileId = decodeURIComponent(params.fileId);
  const d = getDecision(fileId);

  if (!d) {
    return (
      <>
        <Link className="chip" href="/decisions">← Decisions</Link>
        <h1 style={{ marginTop: 14 }}>Not found</h1>
        <p className="muted">No decision recorded for <code>{fileId}</code>. Run the batch first.</p>
      </>
    );
  }

  const ex = (d.extracted ?? {}) as Record<string, unknown>;
  const ev = (d.evidence ?? {}) as Record<string, unknown>;

  return (
    <>
      <Link className="chip" href="/decisions">← Decisions</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0 4px" }}>
        <h1 className="mono" style={{ margin: 0, fontSize: 20 }}>{d.file_id}</h1>
        <span className={`pill ${d.result}`}>{d.result}</span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        reason <b>{d.reason}</b> · rules {d.rules_version} · {d.extraction_method} ·{" "}
        {d.latency_ms != null ? `${d.latency_ms.toFixed(0)}ms` : "—"} · ${d.cost_usd.toFixed(4)}
      </div>

      {/* the decision trace, left-to-right: input → extracted → rules → evidence → result */}
      <div className="section-title">1 · Input</div>
      <div className="card kv">
        <Row k="file_id" v={d.file_id} />
        <Row k="extraction" v={`${d.extraction_method} (${d.extraction_ok ? "ok" : "low confidence"})`} />
      </div>

      <div className="section-title">2 · Extracted fields</div>
      <div className="card kv">
        {["invoice_number", "purchase_order", "supplier_tax_id", "supplier_iban",
          "issue_date", "base", "iva_amount", "iva_rate", "total"].map((key) => (
          <Row key={key} k={key} v={ex[key] != null ? String(ex[key]) : <span className="muted">—</span>} />
        ))}
      </div>

      <div className="section-title">3 · Rules fired (Norma {d.rules_version})</div>
      <div className="card">
        {d.findings.length === 0 ? (
          <span className="pill PAGAR">all checks passed</span>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {d.findings.map((f, i) => (
              <span key={i} className="chip" style={{ color: "var(--escalar)", borderColor: "var(--border)" }}>{f}</span>
            ))}
          </div>
        )}
        <div className="log" style={{ marginTop: 12 }}>{d.reason}</div>
      </div>

      <div className="section-title">4 · Evidence</div>
      <div className="card kv">
        {Object.keys(ev).length === 0 && <div className="muted">no cross-references (failed before matching)</div>}
        {Object.entries(ev).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
      </div>

      <div className="section-title">5 · Decision</div>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className={`pill ${d.result}`}>{d.result}</span>
        <span className="muted">emitted to outcomes.jsonl as</span>
        <code className="mono">{JSON.stringify({ file_id: d.file_id, result: d.result })}</code>
      </div>
    </>
  );
}
