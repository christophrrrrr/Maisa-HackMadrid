"use client";

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { findingColor } from "@/lib/finding-colors";
import { euros, type SupplierRow } from "@/lib/insights";

type SortKey = "escalar" | "euros";
type SortDirection = "asc" | "desc";

function pieBackground(supplier: SupplierRow): string {
  let start = 0;
  const stops = supplier.findings.map((finding) => {
    const end = start + (finding.n / supplier.findingCount) * 100;
    const stop = `${findingColor(finding.code)} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function formatDate(value: string): string {
  if (!value) return "Sin fecha";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function SortMark({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) return <span className="provider-sort-mark">&harr;</span>;
  return (
    <span className="provider-sort-mark">
      {direction === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
}

function ProviderModal({ supplier, onClose }: { supplier: SupplierRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const chartStyle = supplier.findingCount > 0
    ? { background: pieBackground(supplier) } as CSSProperties
    : undefined;

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div
        className="modal provider-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-modal-title"
      >
        <div className="modal-head">
          <div>
            <div className="modal-file" id="provider-modal-title">{supplier.name}</div>
            <div className="dcard-sub mono">{supplier.nif}</div>
          </div>
          <button className="btn ghost sm provider-modal-close" onClick={onClose}>Cerrar</button>
        </div>

        <div className="provider-modal-body">
          <div className="provider-metrics">
            <div className="provider-metric"><span>Facturas procesadas</span><b>{supplier.totalInvoices}</b></div>
            <div className="provider-metric"><span>En revisi&oacute;n</span><b>{supplier.escalar}</b></div>
            <div className="provider-metric"><span>Importe pendiente</span><b>{euros(supplier.euros)}</b></div>
            <div className="provider-metric">
              <span>Extracciones con baja confianza</span>
              <b>{supplier.lowConfidence} de {supplier.totalInvoices}</b>
            </div>
          </div>

          <section className="provider-section">
            <div className="provider-section-head">
              <div>
                <h2>Hallazgos</h2>
                <p>
                  {supplier.findingCount} hallazgo{supplier.findingCount === 1 ? "" : "s"} en{" "}
                  {supplier.findings.length} tipo{supplier.findings.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            {supplier.findingCount > 0 ? (
              <div className="provider-chart-wrap">
                <div
                  className="provider-pie"
                  style={chartStyle}
                  role="img"
                  aria-label={`Distribuci\u00f3n de ${supplier.findingCount} hallazgos`}
                >
                  <div><b>{supplier.findingCount}</b><span>hallazgos</span></div>
                </div>
                <div className="provider-legend">
                  {supplier.findings.map((finding) => (
                    <div className="provider-legend-row" key={finding.code}>
                      <i style={{ background: findingColor(finding.code) }} />
                      <span>{finding.label}</span>
                      <b>{finding.n}</b>
                      <em>{finding.pct}%</em>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="faint">Sin hallazgos registrados.</div>
            )}
          </section>

          <section className="provider-section">
            <div className="provider-section-head">
              <div>
                <h2>Facturas en revisi&oacute;n</h2>
                <p>Selecciona una factura para abrir su revisi&oacute;n completa.</p>
              </div>
              <span className="section-count">{supplier.invoices.length}</span>
            </div>
            <div className="provider-invoices">
              {supplier.invoices.length > 0 ? supplier.invoices.map((invoice) => (
                <a
                  className="provider-invoice"
                  href={`/review?file=${encodeURIComponent(invoice.fileId)}`}
                  key={invoice.fileId}
                >
                  <div className="provider-invoice-main">
                    <b>{invoice.invoiceNumber || invoice.fileId}</b>
                    <span>{invoice.reason}</span>
                  </div>
                  <div className="provider-invoice-meta">
                    <span>{formatDate(invoice.issueDate)}</span>
                    <span className="mono">{invoice.purchaseOrder || "Sin pedido"}</span>
                    <span className={`review-extraction ${invoice.extractionOk ? "ok" : "low"}`}>
                      {invoice.extractionOk ? "Extracci\u00f3n correcta" : "Baja confianza"}
                    </span>
                    <b className="mono">{euros(invoice.total)}</b>
                  </div>
                </a>
              )) : (
                <div className="muted empty-cell">Este proveedor no tiene facturas en revisi&oacute;n.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function ProvidersTable({ suppliers }: { suppliers: SupplierRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("euros");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<SupplierRow | null>(null);

  const sorted = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...suppliers].sort((a, b) => {
      const byValue = (a[sortKey] - b[sortKey]) * direction;
      return byValue || a.name.localeCompare(b.name, "es");
    });
  }, [sortDirection, sortKey, suppliers]);

  const changeSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection("desc");
  };

  const ariaSort = (key: SortKey) => {
    if (sortKey !== key) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  };

  const openFromKeyboard = (event: KeyboardEvent<HTMLTableRowElement>, supplier: SupplierRow) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(supplier);
    }
  };

  return (
    <>
      <div className="card hist-card">
        <div className="hist-scroll">
          <table className="sup-table providers-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>NIF</th>
                <th className="hist-num" aria-sort={ariaSort("escalar")}>
                  <button
                    type="button"
                    className="table-sort provider-sort"
                    onClick={() => changeSort("escalar")}
                    aria-label="Ordenar por facturas en revisi\u00f3n"
                  >
                    En revisi&oacute;n
                    <SortMark active={sortKey === "escalar"} direction={sortDirection} />
                  </button>
                </th>
                <th className="hist-num" aria-sort={ariaSort("euros")}>
                  <button
                    type="button"
                    className="table-sort provider-sort"
                    onClick={() => changeSort("euros")}
                    aria-label="Ordenar por importe en revisi\u00f3n"
                  >
                    Importe en revisi&oacute;n
                    <SortMark active={sortKey === "euros"} direction={sortDirection} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((supplier) => (
                <tr
                  className="provider-row"
                  key={supplier.key}
                  onClick={() => setSelected(supplier)}
                  onKeyDown={(event) => openFromKeyboard(event, supplier)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir detalles de ${supplier.name}`}
                >
                  <td><div className="provider-name">{supplier.name}</div></td>
                  <td className="mono">{supplier.nif}</td>
                  <td className="hist-num">{supplier.escalar}</td>
                  <td className="mono hist-num">{euros(supplier.euros)}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted empty-cell">
                    No hay proveedores con facturas en revisi&oacute;n.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {selected && <ProviderModal supplier={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
