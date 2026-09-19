import type { Decision, RuleCheck } from "@/lib/types";
import { reasonLabel } from "@/lib/reasons";
import { previewKind } from "@/lib/files";

// The end-to-end story for ONE invoice: ingest -> extract -> business rules ->
// ERP reconciliation -> decision. Everything is derived from the persisted
// trace (checks + evidence), so no extra backend call is needed.

type Status = "done" | "fail" | "warn" | "skip";

const NODE_GLYPH: Record<Status, string> = { done: "\u2713", fail: "!", warn: "!", skip: "\u2013" };

const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  image: "Imagen",
  xml: "XML",
  other: "Documento",
};

// business-rule groups (rule 5 is handled separately as ERP reconciliation)
const BUSINESS_RULES = ["1", "2", "3", "4"];
const RULE_LABELS: Record<string, string> = {
  "1": "Proveedor e IBAN",
  "2": "Pedido e importe",
  "3": "Base + IVA",
  "4": "Fecha de emisi\u00f3n",
};

function groupStatus(checks: RuleCheck[]): Status {
  if (checks.length === 0) return "skip";
  return checks.some((c) => c.status === "fail") ? "fail" : "done";
}

function fmt(value: unknown): string {
  if (value == null || value === "") return "\u2014";
  return String(value);
}

function Step({
  status, title, meta, desc, children,
}: {
  status: Status;
  title: string;
  meta?: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={`dtl-step ${status}`}>
      <span className="dtl-node" aria-hidden="true">{NODE_GLYPH[status]}</span>
      <div className="dtl-body">
        <div className="dtl-head">
          <b>{title}</b>
          {meta ? <span className="dtl-meta">{meta}</span> : null}
        </div>
        <div className="dtl-desc">{desc}</div>
        {children}
      </div>
    </li>
  );
}

export default function DecisionTimeline({ d }: { d: Decision }) {
  const checks = d.checks ?? [];
  const businessChecks = checks.filter((c) => BUSINESS_RULES.includes(c.rule));
  const erpChecks = checks.filter((c) => c.rule === "5");
  const gated = !d.extraction_ok;

  const extractionStatus: Status = d.extraction_ok ? "done" : "warn";
  const rulesStatus: Status = gated ? "skip" : groupStatus(businessChecks);
  const erpStatus: Status = gated ? "skip" : groupStatus(erpChecks);
  const decisionStatus: Status =
    d.result === "PAGAR" ? "done" : d.result === "NO_PAGAR" ? "warn" : "fail";

  const kindLabel = KIND_LABEL[previewKind(d.file_id)] ?? "Documento";
  const method = d.extraction_method ?? "\u2014";
  const latency = d.latency_ms != null ? `${d.latency_ms.toFixed(0)} ms` : null;
  const cost = d.cost_usd ? `$${d.cost_usd.toFixed(4)}` : "$0";
  const extractionMeta = [method, latency, cost].filter(Boolean).join(" \u00b7 ");

  const nFail = businessChecks.filter((c) => c.status === "fail").length;
  const nPass = businessChecks.filter((c) => c.status === "pass").length;
  const rulesMeta = businessChecks.length
    ? `${nPass} correctas${nFail ? ` \u00b7 ${nFail} discrepancias` : ""}`
    : undefined;
  const rulesDesc = gated
    ? "No evaluadas: la extracci\u00f3n no fue concluyente."
    : nFail > 0
      ? `${nFail} discrepancia${nFail > 1 ? "s" : ""} frente a las reglas de negocio.`
      : "Todas las comprobaciones de negocio correctas.";

  const ev = (d.evidence ?? {}) as Record<string, unknown>;
  const asiento = ev.erp_asiento ? String(ev.erp_asiento) : null;
  const estado = ev.erp_status ? String(ev.erp_status) : null;
  const erpAmountCheck = checks.find((c) => c.code === "erp_amount_mismatch");
  const importeEsperado = erpAmountCheck?.expected?.value;
  const totalFactura = erpAmountCheck?.actual?.value;
  const noAsiento = erpChecks.some((c) => c.code === "pedido_not_in_erp" && c.status === "fail");
  const erpDesc = gated
    ? "No conciliado."
    : noAsiento
      ? "El pedido no tiene asiento contable en el ERP."
      : asiento
        ? "Conciliado con el asiento del ERP (fuente autoritativa)."
        : "Sin conciliaci\u00f3n ERP disponible.";

  return (
    <section className="trace-section">
      <div className="trace-section-head">
        <span>{"Cronolog\u00eda de la decisi\u00f3n"}</span>
      </div>
      <ol className="dtl">
        <Step status="done" title="Ingesta" meta={kindLabel} desc={d.file_id} />

        <Step
          status={extractionStatus}
          title={"Extracci\u00f3n"}
          meta={extractionMeta}
          desc={d.extraction_ok
            ? "Campos le\u00eddos de la factura."
            : (d.detail || "Lectura con baja confianza; se escala para revisi\u00f3n.")}
        />

        <Step status={rulesStatus} title="Reglas de negocio" meta={rulesMeta} desc={rulesDesc}>
          {!gated && businessChecks.length > 0 && (
            <div className="dtl-chips">
              {BUSINESS_RULES.map((r) => {
                const rc = businessChecks.filter((c) => c.rule === r);
                if (rc.length === 0) return null;
                return (
                  <span key={r} className={`dtl-chip ${groupStatus(rc)}`}>
                    {RULE_LABELS[r]}
                  </span>
                );
              })}
            </div>
          )}
        </Step>

        <Step
          status={erpStatus}
          title={"Conciliaci\u00f3n ERP"}
          meta={asiento ? `Asiento ${asiento}` : undefined}
          desc={erpDesc}
        >
          {!gated && asiento && (
            <div className="dtl-erp">
              <div>
                <span>Estado</span>
                <b className={estado === "PAGADA" ? "warnc" : ""}>{fmt(estado)}</b>
              </div>
              <div>
                <span>Importe esperado</span>
                <b>{fmt(importeEsperado)}</b>
              </div>
              <div>
                <span>Total factura</span>
                <b>{fmt(totalFactura)}</b>
              </div>
            </div>
          )}
        </Step>

        <Step
          status={decisionStatus}
          title={"Decisi\u00f3n"}
          meta={d.rules_version || undefined}
          desc={reasonLabel(d.reason) || "sin motivo"}
        >
          <span className={`pill ${d.result}`}>{d.result}</span>
        </Step>
      </ol>
    </section>
  );
}
