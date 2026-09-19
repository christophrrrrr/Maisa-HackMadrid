import type { CheckValue, Decision, RuleCheck } from "@/lib/types";
import { reasonLabel } from "@/lib/reasons";
import DecisionTimeline from "./DecisionTimeline";

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

const FIELD_LABELS = Object.fromEntries(FIELDS);

function display(value: unknown): React.ReactNode {
  if (value == null || value === "") return DASH;
  return String(value);
}

function ComparedValue({ value, tone }: { value: CheckValue; tone: "actual" | "expected" }) {
  return (
    <div className={`compare-value ${tone}`}>
      <div className="compare-label">{value.label}</div>
      <div className="compare-data">{display(value.value)}</div>
      <div className="compare-source">{value.source}</div>
    </div>
  );
}

function CheckCard({ check }: { check: RuleCheck }) {
  return (
    <div className={`check-card ${check.status}`}>
      <div className="check-head">
        <span className="check-icon" aria-hidden="true">
          {check.status === "pass" ? "\u2713" : check.status === "fail" ? "!" : "\u2013"}
        </span>
        <div className="check-title">
          <b>{check.label}</b>
          <span>Regla {check.rule}</span>
        </div>
      </div>
      {(check.actual || check.expected) && (
        <div className="comparison">
          {check.actual && <ComparedValue value={check.actual} tone="actual" />}
          {check.actual && check.expected && <span className="compare-arrow">vs.</span>}
          {check.expected && <ComparedValue value={check.expected} tone="expected" />}
        </div>
      )}
      <div className="check-message">{check.message}</div>
    </div>
  );
}

export default function DecisionTrace({ d }: { d: Decision }) {
  const ex = (d.extracted ?? {}) as Record<string, unknown>;
  const ev = (d.evidence ?? {}) as Record<string, unknown>;
  const checks = d.checks ?? [];
  const failed = checks.filter((check) => check.status === "fail");
  const passed = checks.filter((check) => check.status === "pass");
  const skipped = checks.filter((check) => check.status === "skipped");
  const sourceEvidence = d.extraction_evidence ?? {};
  const primary = failed.find((check) => check.code === d.reason) ?? failed[0];
  const summary = reasonLabel(d.reason) || primary?.message || "sin motivo";
  const action = d.result === "PAGAR"
    ? "No requiere revisi\u00f3n manual."
    : d.result === "NO_PAGAR"
      ? "No emitir el pago. Validar el bloqueo antes de cerrar la incidencia."
      : "Revisar la discrepancia y corregir la factura o la fuente de referencia.";

  return (
    <div className="decision-detail">
      <section className={`decision-summary ${d.result}`}>
        <div className="summary-top">
          <span className={`pill ${d.result}`}>{d.result}</span>
        </div>
        <h2>{summary}</h2>
        <p>{action}</p>
      </section>

      <DecisionTimeline d={d} />

      {failed.length > 0 && (
        <section className="trace-section">
          <div className="trace-section-head">
            <span>Discrepancias</span>
            <span className="section-count">{failed.length}</span>
          </div>
          <div className="check-list">
            {failed.map((check, index) => <CheckCard key={`${check.code}-${index}`} check={check} />)}
          </div>
        </section>
      )}

      {checks.length === 0 && (
        <section className="trace-section">
          <div className="reason-box">
            {"El trazado comparativo estar\u00e1 disponible despu\u00e9s de volver a procesar esta factura."}
            {d.detail ? ` ${d.detail}` : ""}
          </div>
        </section>
      )}

      <section className="trace-section">
        <div className="trace-section-head">
          <span>{"Campos le\u00eddos de la factura"}</span>
        </div>
        {d.extracted != null ? (
          <KV rows={FIELDS.map(([k, label]) => [
            label, ex[k] != null && ex[k] !== "" ? String(ex[k]) : DASH,
          ])} />
        ) : (
          <div className="faint">{"Los campos se cargar\u00e1n al terminar la ejecuci\u00f3n."}</div>
        )}
      </section>

      {(passed.length > 0 || skipped.length > 0) && (
        <details className="trace-details">
          <summary>
            Comprobaciones restantes
            <span>{passed.length} correctas{skipped.length ? ` \u00b7 ${skipped.length} omitidas` : ""}</span>
          </summary>
          <div className="check-list compact">
            {[...passed, ...skipped].map((check, index) => (
              <CheckCard key={`${check.code}-${index}`} check={check} />
            ))}
          </div>
        </details>
      )}

      {Object.keys(sourceEvidence).length > 0 && (
        <details className="trace-details">
          <summary>
            Evidencia del documento
            <span>{Object.keys(sourceEvidence).length} campos con referencia</span>
          </summary>
          <div className="source-list">
            {Object.entries(sourceEvidence).map(([field, evidence]) => (
              <div className="source-row" key={field}>
                <div>
                  <b>{FIELD_LABELS[field] ?? field}</b>
                  <span>{"P\u00e1gina"} {evidence.page}</span>
                </div>
                <q>{evidence.text}</q>
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="trace-details">
        <summary>
          {"Detalles t\u00e9cnicos"}
          <span>{d.rules_version || "sin versi\u00f3n"}</span>
        </summary>
        <KV rows={[
          ["archivo", d.file_id],
          ["run id", d.run_id || DASH],
          ["extracci\u00f3n", `${d.extraction_method ?? "-"} (${d.extraction_ok ? "correcta" : "baja confianza"})`],
          ["normativa", d.rules_version || DASH],
          ["latencia", d.latency_ms != null ? `${d.latency_ms.toFixed(0)} ms` : DASH],
          ["coste", d.cost_usd ? `$${d.cost_usd.toFixed(4)}` : "$0"],
          ["actualizado", d.updated_at || DASH],
          ...Object.entries(ev).map(([key, value]) => [key, display(value)] as [string, React.ReactNode]),
        ]} />
      </details>
    </div>
  );
}
