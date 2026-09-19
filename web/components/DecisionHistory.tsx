"use client";

import { useMemo, useState } from "react";
import type { Decision, RunRow } from "@/lib/types";
import DecisionModal from "./DecisionModal";
import { reasonLabel } from "@/lib/reasons";

const PAGE_SIZE = 20;

function fmtWhen(iso: string) {
  if (!iso) return "—";
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
  if (!m) return "—";
  const base = m.replace(/\(low-conf\)/g, "").trim();
  if (base === "baseline-regex") return "regex";
  if (base === "llm-vision") return "visión";
  return base;
}

function field(d: Decision, key: string): unknown {
  return (d.extracted ?? {})[key];
}

function evidence(d: Decision, key: string): unknown {
  return (d.evidence ?? {})[key];
}

function rowKey(d: Decision) {
  return `${d.run_id || "norun"}:${d.file_id}`;
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
}: {
  decisions: Decision[];
  runs?: RunRow[];
  showHeader?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState("ALL");

  const filtered = useMemo(() => {
    const list = runFilter === "ALL"
      ? decisions
      : decisions.filter((d) => d.run_id === runFilter);
    return [...list].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")
      || a.file_id.localeCompare(b.file_id));
  }, [decisions, runFilter]);

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

      {runs.length > 0 && (
        <div className="filters">
          <select
            className="field"
            value={runFilter}
            onChange={(e) => { setRunFilter(e.target.value); setPage(0); }}
          >
            <option value="ALL">Todas las ejecuciones</option>
            {runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {fmtWhen(run.started_at)} · {run.total} archivos
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card hist-card">
        <div className="hist-scroll">
          <table className="hist-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Archivo</th>
                <th>Resultado</th>
                <th>Motivo</th>
                <th>N. factura</th>
                <th>Pedido</th>
                <th>NIF</th>
                <th>IBAN</th>
                <th className="hist-num">Total</th>
                <th>Asiento</th>
                <th>Extracción</th>
                <th>Hallazgos</th>
                <th>Latencia</th>
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
                          {d.findings.slice(0, 2).map((f) => (
                            <span key={f} className="finding">{reasonLabel(f)}</span>
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
              {`${from + 1}–${to} de ${filtered.length}`}
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
                  <span key={`gap-${i}`} className="pager-gap muted">…</span>
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
