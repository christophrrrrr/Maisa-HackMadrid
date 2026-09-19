"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { findingBadgeStyle } from "@/lib/finding-colors";
import type { Decision, RunRow } from "@/lib/types";
import DecisionModal from "./DecisionModal";
import { reasonLabel } from "@/lib/reasons";

const PAGE_SIZE = 20;
type ResultFilter = "ALL" | Decision["result"];
type ExtractionFilter = "ALL" | "OK" | "LOW";
type SortDirection = "asc" | "desc";
type SortKey =
  | "updated_at"
  | "invoice_number"
  | "purchase_order"
  | "total"
  | "erp_asiento"
  | "latency_ms";

function SortMark({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <span className="provider-sort-mark">&harr;</span>;
  return (
    <span className="provider-sort-mark">
      {direction === "asc" ? "\u2191" : "\u2193"}
    </span>
  );
}

function SortHeader({
  column,
  active,
  direction,
  onSort,
  className,
  children,
}: {
  column: SortKey;
  active: boolean;
  direction: SortDirection;
  onSort: (column: SortKey) => void;
  className?: string;
  children: ReactNode;
}) {
  const ariaSort: "none" | "ascending" | "descending" = active
    ? direction === "asc" ? "ascending" : "descending"
    : "none";
  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        className="table-sort"
        onClick={() => onSort(column)}
        aria-label={`Ordenar por ${column}`}
      >
        {children}
        <SortMark active={active} direction={direction} />
      </button>
    </th>
  );
}

function fmtWhen(iso: string) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function dash(v: unknown) {
  if (v == null || v === "") return <span className="faint">&mdash;</span>;
  return String(v);
}

function money(v: unknown) {
  if (v == null || v === "") return <span className="faint">&mdash;</span>;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function methodLabel(m: string | null) {
  if (!m) return "\u2014";
  const base = m.replace(/\(low-conf\)/g, "").trim();
  if (base === "baseline-regex") return "regex";
  if (base === "llm-vision") return "visi\u00f3n";
  return base;
}

function field(d: Decision, key: string): unknown {
  return (d.extracted ?? {})[key];
}

function textField(d: Decision, key: string): string {
  const value = field(d, key);
  return value == null ? "" : String(value).trim();
}

function evidence(d: Decision, key: string): unknown {
  return (d.evidence ?? {})[key];
}

function sortValue(d: Decision, key: SortKey): string | number | null {
  switch (key) {
    case "updated_at":
      return Date.parse(d.updated_at) || null;
    case "invoice_number":
    case "purchase_order":
      return textField(d, key) || null;
    case "total": {
      const amount = Number(field(d, "total"));
      return Number.isFinite(amount) ? amount : null;
    }
    case "erp_asiento": {
      const asiento = evidence(d, "erp_asiento");
      return asiento == null || asiento === "" ? null : String(asiento);
    }
    case "latency_ms":
      return d.latency_ms;
  }
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection,
): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const compared = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? compared : -compared;
}

function rowKey(d: Decision) {
  return `${d.run_id || "norun"}:${d.file_id}`;
}

function supplierKey(d: Decision): string {
  return textField(d, "supplier_tax_id") || textField(d, "supplier_name");
}

function localDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function searchText(d: Decision): string {
  const extracted = d.extracted ?? {};
  const evidenceValues = Object.values(d.evidence ?? {});
  return [
    d.file_id,
    d.run_id,
    d.result,
    d.reason,
    reasonLabel(d.reason),
    ...d.findings,
    ...d.findings.map((finding) => reasonLabel(finding)),
    extracted.invoice_number,
    extracted.purchase_order,
    extracted.supplier_name,
    extracted.supplier_tax_id,
    extracted.supplier_iban,
    extracted.total,
    ...evidenceValues,
  ].map((value) => value == null ? "" : String(value)).join(" ").toLowerCase();
}

function pageItems(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const keep = new Set([0, total - 1, current, current - 1, current + 1]);
  if (current <= 2) { keep.add(2); keep.add(3); }
  if (current >= total - 3) { keep.add(total - 4); keep.add(total - 3); }
  const sorted = [...keep].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let prev = -2;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

export default function DecisionHistory({
  decisions,
  runs = [],
  showHeader = true,
  initialRunId = "ALL",
}: {
  decisions: Decision[];
  runs?: RunRow[];
  showHeader?: boolean;
  initialRunId?: string;
}) {
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [runFilter, setRunFilter] = useState(initialRunId);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [extractionFilter, setExtractionFilter] = useState<ExtractionFilter>("ALL");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const changeSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    setPage(0);
  };

  const reasons = useMemo(() => {
    const values = new Set(decisions.map((d) => d.reason).filter(Boolean));
    return [...values].sort((a, b) => reasonLabel(a).localeCompare(reasonLabel(b), "es"));
  }, [decisions]);

  const suppliers = useMemo(() => {
    const values = new Map<string, string>();
    decisions.forEach((d) => {
      const nif = textField(d, "supplier_tax_id");
      const name = textField(d, "supplier_name");
      const key = nif || name;
      if (key) values.set(key, name ? `${name}${nif ? ` \u00b7 ${nif}` : ""}` : nif);
    });
    return [...values].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [decisions]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = decisions.filter((d) => {
      if (runFilter !== "ALL" && d.run_id !== runFilter) return false;
      if (resultFilter !== "ALL" && d.result !== resultFilter) return false;
      if (extractionFilter === "OK" && !d.extraction_ok) return false;
      if (extractionFilter === "LOW" && d.extraction_ok) return false;
      if (reasonFilter !== "ALL" && d.reason !== reasonFilter) return false;
      if (supplierFilter !== "ALL" && supplierKey(d) !== supplierFilter) return false;
      const decisionDate = localDateKey(d.updated_at);
      if (dateFilter && decisionDate !== dateFilter) return false;
      if (dateFrom && (!decisionDate || decisionDate < dateFrom)) return false;
      if (dateTo && (!decisionDate || decisionDate > dateTo)) return false;
      return !needle || searchText(d).includes(needle);
    });
    return [...list].sort((a, b) => {
      const compared = compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDirection);
      return compared || a.file_id.localeCompare(b.file_id, "es");
    });
  }, [
    dateFilter,
    dateFrom,
    dateTo,
    decisions,
    extractionFilter,
    query,
    reasonFilter,
    resultFilter,
    runFilter,
    sortDirection,
    sortKey,
    supplierFilter,
  ]);

  const filtersOn = Boolean(
    query.trim() || runFilter !== "ALL" || resultFilter !== "ALL" || extractionFilter !== "ALL"
      || reasonFilter !== "ALL" || supplierFilter !== "ALL" || dateFilter || dateFrom || dateTo,
  );

  const clearFilters = () => {
    setQuery("");
    setRunFilter("ALL");
    setResultFilter("ALL");
    setExtractionFilter("ALL");
    setReasonFilter("ALL");
    setSupplierFilter("ALL");
    setDateFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE;
  const slice = filtered.slice(from, from + PAGE_SIZE);
  const to = from + slice.length;
  const selected = selectedKey
    ? filtered.find((d) => rowKey(d) === selectedKey) ?? null
    : null;

  return (
    <>
      {showHeader && (
        <div className="hist-head">
          <div className="section-title" style={{ margin: 0 }}>Historial de decisiones</div>
          <div className="meta">
            {filtered.length === 0
              ? "Sin decisiones"
              : `${filtered.length} registro${filtered.length === 1 ? "" : "s"}`}
          </div>
        </div>
      )}

      <div className="filters history-filters">
        <input
          className="search"
          type="search"
          aria-label="Buscar en el historial"
          placeholder="Buscar archivo, factura, pedido, proveedor, NIF, IBAN..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
        />
        <select
          className="field"
          aria-label="Filtrar por resultado"
          value={resultFilter}
          onChange={(e) => {
            setResultFilter(e.target.value as ResultFilter);
            setPage(0);
          }}
        >
          <option value="ALL">Todos los resultados</option>
          <option value="PAGAR">Pagar</option>
          <option value="NO_PAGAR">No pagar</option>
          <option value="ESCALAR">Escalar</option>
        </select>
        <select
          className="field"
          aria-label="Filtrar por motivo"
          value={reasonFilter}
          onChange={(e) => { setReasonFilter(e.target.value); setPage(0); }}
        >
          <option value="ALL">Todos los motivos</option>
          {reasons.map((reason) => (
            <option key={reason} value={reason}>{reasonLabel(reason)}</option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Filtrar por proveedor"
          value={supplierFilter}
          onChange={(e) => { setSupplierFilter(e.target.value); setPage(0); }}
        >
          <option value="ALL">Todos los proveedores</option>
          {suppliers.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Filtrar por calidad de extraccion"
          value={extractionFilter}
          onChange={(e) => {
            setExtractionFilter(e.target.value as ExtractionFilter);
            setPage(0);
          }}
        >
          <option value="ALL">Toda extracci&oacute;n</option>
          <option value="OK">Extracci&oacute;n correcta</option>
          <option value="LOW">Baja confianza</option>
        </select>
        {runs.length > 0 && (
          <select
            className="field"
            aria-label="Filtrar por ejecucion"
            value={runFilter}
            onChange={(e) => { setRunFilter(e.target.value); setPage(0); }}
          >
            <option value="ALL">Todas las ejecuciones</option>
            {runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {fmtWhen(run.started_at)} &middot; {run.total} archivos
              </option>
            ))}
          </select>
        )}
        <label className="history-date-field">
          <span>Fecha</span>
          <input
            className="field"
            type="date"
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setDateFrom("");
              setDateTo("");
              setPage(0);
            }}
          />
        </label>
        <label className="history-date-field">
          <span>Desde</span>
          <input
            className="field"
            type="date"
            max={dateTo || undefined}
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setDateFilter("");
              setPage(0);
            }}
          />
        </label>
        <label className="history-date-field">
          <span>Hasta</span>
          <input
            className="field"
            type="date"
            min={dateFrom || undefined}
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setDateFilter("");
              setPage(0);
            }}
          />
        </label>
        <span className="meta">{filtered.length} de {decisions.length}</span>
        {filtersOn && (
          <button type="button" className="btn ghost sm" onClick={clearFilters}>
            Limpiar
          </button>
        )}
      </div>

      <div className="card hist-card">
        <div className="hist-scroll">
          <table className="hist-table">
            <thead>
              <tr>
                <SortHeader column="updated_at" active={sortKey === "updated_at"} direction={sortDirection} onSort={changeSort}>
                  Fecha
                </SortHeader>
                <th>Archivo</th>
                <th>Resultado</th>
                <th>Motivo</th>
                <SortHeader column="invoice_number" active={sortKey === "invoice_number"} direction={sortDirection} onSort={changeSort}>
                  N. factura
                </SortHeader>
                <SortHeader column="purchase_order" active={sortKey === "purchase_order"} direction={sortDirection} onSort={changeSort}>
                  Pedido
                </SortHeader>
                <th>NIF</th>
                <th>IBAN</th>
                <SortHeader column="total" active={sortKey === "total"} direction={sortDirection} onSort={changeSort} className="hist-num">
                  Total
                </SortHeader>
                <SortHeader column="erp_asiento" active={sortKey === "erp_asiento"} direction={sortDirection} onSort={changeSort}>
                  Asiento
                </SortHeader>
                <th>Extracci&oacute;n</th>
                <th>Hallazgos</th>
                <SortHeader column="latency_ms" active={sortKey === "latency_ms"} direction={sortDirection} onSort={changeSort}>
                  Latencia
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {slice.map((d) => {
                const key = rowKey(d);
                return (
                  <tr
                    key={key}
                    className={selectedKey === key ? "open" : ""}
                    onClick={() => setSelectedKey(key)}
                    title="Ver detalle"
                  >
                    <td className="muted">{fmtWhen(d.updated_at) || dash(null)}</td>
                    <td className="mono hist-file">{d.file_id}</td>
                    <td><span className={`pill ${d.result}`}>{d.result}</span></td>
                    <td>{dash(reasonLabel(d.reason))}</td>
                    <td className="mono">{dash(field(d, "invoice_number"))}</td>
                    <td className="mono">{dash(field(d, "purchase_order"))}</td>
                    <td className="mono">{dash(field(d, "supplier_tax_id"))}</td>
                    <td className="mono hist-iban">{dash(field(d, "supplier_iban"))}</td>
                    <td className="mono hist-num">{money(field(d, "total"))}</td>
                    <td className="mono">{dash(evidence(d, "erp_asiento"))}</td>
                    <td>
                      <div className="hist-extract">
                        <span className="mono muted">{methodLabel(d.extraction_method)}</span>
                        {!d.extraction_ok && <span className="pill ESCALAR">baja</span>}
                      </div>
                    </td>
                    <td>
                      {d.findings && d.findings.length > 0 ? (
                        <div className="findings hist-findings">
                          {d.findings.slice(0, 2).map((finding) => (
                            <span key={finding} className="finding" style={findingBadgeStyle(finding)}>
                              {reasonLabel(finding)}
                            </span>
                          ))}
                          {d.findings.length > 2 && (
                            <span className="chip">+{d.findings.length - 2}</span>
                          )}
                        </div>
                      ) : (
                        <span className="faint">ninguno</span>
                      )}
                    </td>
                    <td className="mono muted">
                      {d.latency_ms != null ? `${Math.round(d.latency_ms)} ms` : dash(null)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr className="hist-empty">
                  <td colSpan={13} className="muted empty-cell">Sin decisiones.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="pager">
            <span className="meta">
              {`${from + 1}-${to} de ${filtered.length}`}
            </span>
            <div className="pager-btns">
              <button
                type="button"
                className="btn ghost sm"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Anterior
              </button>
              {pageItems(safePage, totalPages).map((item, i) =>
                item === "gap" ? (
                  <span key={`gap-${i}`} className="pager-gap muted">&hellip;</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`btn ghost sm pager-num${item === safePage ? " on" : ""}`}
                    onClick={() => setPage(item)}
                  >
                    {item + 1}
                  </button>
                ),
              )}
              <button
                type="button"
                className="btn ghost sm"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && <DecisionModal d={selected} onClose={() => setSelectedKey(null)} />}
    </>
  );
}
