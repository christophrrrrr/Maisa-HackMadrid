"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { findingBadgeStyle } from "@/lib/finding-colors";
import type { Decision, Policy, StateSnapshot } from "@/lib/types";
import { reasonLabel } from "@/lib/reasons";
import DecisionModal from "./DecisionModal";
import { withFileDefaults } from "@/lib/files";
import {
  INCIDENT_STATUS_EVENT, incidentKey, isIncidentSent,
} from "@/lib/incident-status";

type Conf = "ALL" | "OK" | "LOW";
type DateOrder = "DESC" | "ASC";
type IncidentStatus = "ALL" | "PENDING" | "SENT";

function value(d: Decision, key: string): unknown {
  return (d.extracted ?? {})[key];
}

function textValue(d: Decision, key: string): string {
  const raw = value(d, key);
  return raw == null ? "" : String(raw).trim();
}

function displayValue(raw: unknown) {
  return raw == null || raw === "" ? <span className="faint">&mdash;</span> : String(raw);
}

function money(raw: unknown) {
  const amount = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(amount)) return displayValue(raw);
  return amount.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function fmtWhen(iso: string) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function haystack(d: Decision, policy: Policy | null): string {
  const ex = (d.extracted ?? {}) as Record<string, unknown>;
  const ev = (d.evidence ?? {}) as Record<string, unknown>;
  const findings = d.findings || [];
  return [
    d.file_id, d.reason, reasonLabel(d.reason, policy), d.result,
    ...findings, ...findings.map((f) => reasonLabel(f, policy)),
    ex.invoice_number, ex.purchase_order, ex.supplier_tax_id, ex.supplier_iban, ex.total,
    ev.pedido, ev.supplier_id, ev.erp_asiento, ev.erp_status,
  ].map((x) => (x == null ? "" : String(x))).join(" ").toLowerCase();
}

export default function DecisionBoard() {
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("file")
      : null),
  );
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("ALL");
  const [conf, setConf] = useState<Conf>("ALL");
  const [supplier, setSupplier] = useState("ALL");
  const [incidentStatus, setIncidentStatus] = useState<IncidentStatus>("ALL");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [dateOrder, setDateOrder] = useState<DateOrder>("DESC");
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<Policy | null>(null);

  const loadState = useCallback(async () => {
    const snap: StateSnapshot = await fetch("/api/state").then((r) => r.json());
    setDecisions(new Map(snap.decisions.map((d) => [d.file_id, d])));
  }, []);

  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("file", selectedId);
    else url.searchParams.delete("file");
    window.history.replaceState(null, "", url.toString());
  }, [selectedId]);
  useEffect(() => {
    fetch("/api/policy").then((r) => r.json()).then((pol: Policy) => setPolicy(withFileDefaults(pol))).catch(() => {});
  }, []);

  const all = useMemo(() => [...decisions.values()], [decisions]);
  useEffect(() => {
    setSentKeys(new Set(all.filter(isIncidentSent).map(incidentKey)));
  }, [all]);
  useEffect(() => {
    const update = (event: Event) => {
      const { key, sent } = (event as CustomEvent<{ key: string; sent: boolean }>).detail;
      setSentKeys((current) => {
        const next = new Set(current);
        if (sent) next.add(key);
        else next.delete(key);
        return next;
      });
    };
    window.addEventListener(INCIDENT_STATUS_EVENT, update);
    return () => window.removeEventListener(INCIDENT_STATUS_EVENT, update);
  }, []);

  const pool = useMemo(() => all.filter((d) => d.result === "ESCALAR"), [all]);
  const reasons = useMemo(() => {
    const s = new Set(pool.map((d) => d.reason).filter(Boolean));
    return [...s].sort((a, b) => reasonLabel(a, policy).localeCompare(reasonLabel(b, policy), "es"));
  }, [pool, policy]);
  const suppliers = useMemo(() => {
    const options = new Map<string, string>();
    pool.forEach((d) => {
      const nif = textValue(d, "supplier_tax_id");
      const name = textValue(d, "supplier_name");
      const key = nif || name;
      if (key) options.set(key, name ? `${name}${nif ? ` \u00b7 ${nif}` : ""}` : nif);
    });
    return [...options].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [pool]);

  const needle = q.trim().toLowerCase();
  const match = (d: Decision) => {
    if (reason !== "ALL" && d.reason !== reason) return false;
    if (conf === "OK" && !d.extraction_ok) return false;
    if (conf === "LOW" && d.extraction_ok) return false;
    const sent = sentKeys.has(incidentKey(d));
    if (incidentStatus === "SENT" && !sent) return false;
    if (incidentStatus === "PENDING" && sent) return false;
    const supplierKey = textValue(d, "supplier_tax_id") || textValue(d, "supplier_name");
    if (supplier !== "ALL" && supplierKey !== supplier) return false;
    const amount = Number(value(d, "total"));
    if (minAmount && (!Number.isFinite(amount) || amount < Number(minAmount))) return false;
    if (maxAmount && (!Number.isFinite(amount) || amount > Number(maxAmount))) return false;
    if (needle && !haystack(d, policy).includes(needle)) return false;
    return true;
  };
  const revise = pool.filter(match).sort((a, b) => {
    const byDate = (a.updated_at || "").localeCompare(b.updated_at || "");
    return (dateOrder === "ASC" ? byDate : -byDate) || a.file_id.localeCompare(b.file_id);
  });
  const selected = selectedId ? decisions.get(selectedId) ?? null : null;
  const filtersOn = Boolean(
    needle || reason !== "ALL" || conf !== "ALL" || supplier !== "ALL"
      || incidentStatus !== "ALL" || minAmount || maxAmount,
  );

  const clearFilters = () => {
    setQ("");
    setReason("ALL");
    setConf("ALL");
    setSupplier("ALL");
    setIncidentStatus("ALL");
    setMinAmount("");
    setMaxAmount("");
  };

  return (
    <>
      <div className="board-head">
        <h1>Revisi&oacute;n</h1>
      </div>

      <div className="filters review-filters">
        <input
          className="search"
          placeholder="Buscar factura, pedido, proveedor, NIF, IBAN..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="ALL">Todos los motivos</option>
          {reasons.map((r) => <option key={r} value={r}>{reasonLabel(r, policy)}</option>)}
        </select>
        <select className="field" value={conf} onChange={(e) => setConf(e.target.value as Conf)}>
          <option value="ALL">Toda extracci&oacute;n</option>
          <option value="OK">Extracci&oacute;n correcta</option>
          <option value="LOW">Baja confianza</option>
        </select>
        <select className="field" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="ALL">Todos los proveedores</option>
          {suppliers.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select
          className="field"
          aria-label="Filtrar por estado"
          value={incidentStatus}
          onChange={(e) => setIncidentStatus(e.target.value as IncidentStatus)}
        >
          <option value="ALL">Todos los estados</option>
          <option value="PENDING">Pendiente</option>
          <option value="SENT">Enviado</option>
        </select>
        <input
          className="field amount-filter"
          type="number"
          min="0"
          step="0.01"
          placeholder="Importe min."
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
        />
        <input
          className="field amount-filter"
          type="number"
          min="0"
          step="0.01"
          placeholder="Importe max."
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
        />
        <span className="meta">{revise.length} de {pool.length}</span>
        {filtersOn && <button className="btn ghost sm" onClick={clearFilters}>Limpiar</button>}
      </div>

      <div className="card hist-card review-card">
        <div className="hist-scroll">
          <table className="hist-table review-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className="table-sort"
                    onClick={() => setDateOrder((order) => order === "DESC" ? "ASC" : "DESC")}
                    aria-label={`Ordenar por fecha ${dateOrder === "DESC" ? "ascendente" : "descendente"}`}
                  >
                    Fecha <span aria-hidden="true">{dateOrder === "DESC" ? "\u2193" : "\u2191"}</span>
                  </button>
                </th>
                <th>Factura</th>
                <th>Proveedor</th>
                <th>NIF</th>
                <th>Pedido</th>
                <th className="hist-num">Total</th>
                <th>Incidencia</th>
                <th>Extracci&oacute;n</th>
                <th>Hallazgos</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {revise.map((d) => (
                <tr
                  key={d.file_id}
                  className={selectedId === d.file_id ? "open" : ""}
                  onClick={() => setSelectedId(d.file_id)}
                  title="Ver factura"
                >
                  <td className="muted">{fmtWhen(d.updated_at)}</td>
                  <td>
                    <div className="mono">{displayValue(value(d, "invoice_number"))}</div>
                    <div className="review-file muted">{d.file_id}</div>
                  </td>
                  <td>{displayValue(value(d, "supplier_name"))}</td>
                  <td className="mono">{displayValue(value(d, "supplier_tax_id"))}</td>
                  <td className="mono">{displayValue(value(d, "purchase_order"))}</td>
                  <td className="mono hist-num">{money(value(d, "total"))}</td>
                  <td>
                    <span className="finding" style={findingBadgeStyle(d.reason)}>
                      {reasonLabel(d.reason, policy)}
                    </span>
                  </td>
                  <td>
                    <span className={`review-extraction ${d.extraction_ok ? "ok" : "low"}`}>
                      {d.extraction_ok ? "Correcta" : "Baja confianza"}
                    </span>
                  </td>
                  <td>
                    {d.findings?.length
                      ? <span className="muted">{d.findings.length} incidencia{d.findings.length === 1 ? "" : "s"}</span>
                      : <span className="faint">ninguno</span>}
                  </td>
                  <td>
                    <span className={`incident-status ${sentKeys.has(incidentKey(d)) ? "sent" : "pending"}`}>
                      {sentKeys.has(incidentKey(d)) ? "Enviado" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              ))}
              {revise.length === 0 && (
                <tr className="hist-empty">
                  <td colSpan={10} className="muted empty-cell">No hay facturas con estos filtros.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="review-table-footer">
          <span className="meta">
            {revise.length} factura{revise.length === 1 ? "" : "s"} pendiente{revise.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {selected && <DecisionModal d={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}
