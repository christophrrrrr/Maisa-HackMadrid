import type { Decision } from "@/lib/types";

const FIELDS: [string, string][] = [
  ["invoice_number", "N. factura"],
  ["purchase_order", "Pedido"],
  ["supplier_tax_id", "NIF"],
  ["supplier_iban", "IBAN"],
  ["issue_date", "Fecha"],
  ["base", "Base"],
  ["iva_amount", "IVA"],
  ["iva_rate", "Tipo IVA"],
  ["total", "Total"],
];

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="trace-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <div className="tk">{k}</div>
          <div className="tv">{v}</div>
        </div>
      ))}
    </div>
  );
}

const DASH = <span className="faint">&mdash;</span>;

export default function DecisionTrace({ d }: { d: Decision }) {
  const ex = (d.extracted ?? {}) as Record<string, unknown>;
  const ev = (d.evidence ?? {}) as Record<string, unknown>;
  const hasDetail = d.extracted != null || (d.findings && d.findings.length > 0) || Object.keys(ev).length > 0;

  return (
    <div className="dcard-body">
      {!hasDetail && (
        <div className="trace-step">
          <div className="reason-box">
            {"Decisi\u00f3n emitida. Motivo: "}<b>{d.reason}</b>{". El trazado completo se carga al finalizar la ejecuci\u00f3n."}
          </div>
        </div>
      )}

      <div className="trace-step">
        <div className="lbl">{"1 \u00b7 Entrada"}</div>
        <KV rows={[
          ["archivo", d.file_id],
          ["extracci\u00f3n", `${d.extraction_method ?? "-"} (${d.extraction_ok ? "correcta" : "baja confianza"})`],
        ]} />
      </div>

      {d.extracted != null && (
        <div className="trace-step">
          <div className="lbl">{"2 \u00b7 Campos extra\u00eddos"}</div>
          <KV rows={FIELDS.map(([k, label]) => [
            label, ex[k] != null && ex[k] !== "" ? String(ex[k]) : DASH,
          ])} />
        </div>
      )}

      <div className="trace-step">
        <div className="lbl">{"3 \u00b7 Reglas aplicadas (Norma "}{d.rules_version}{")"}</div>
        {d.findings && d.findings.length > 0 ? (
          <div className="findings">
            {d.findings.map((f, i) => <span key={i} className="finding">{f}</span>)}
          </div>
        ) : (
          <span className="pill PAGAR">todas las comprobaciones correctas</span>
        )}
        {d.reason && <div className="reason-box">{d.reason}</div>}
      </div>

      {Object.keys(ev).length > 0 && (
        <div className="trace-step">
          <div className="lbl">{"4 \u00b7 Evidencia"}</div>
          <KV rows={Object.entries(ev).map(([k, v]) => [k, String(v)])} />
        </div>
      )}

      <div className="trace-step">
        <div className="lbl">{"5 \u00b7 Decisi\u00f3n"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={`pill ${d.result}`}>{d.result}</span>
          <span className="faint" style={{ fontSize: 12 }}>
            {d.latency_ms != null ? `${d.latency_ms.toFixed(0)} ms` : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}
