"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Decision, Policy, Result, StateSnapshot } from "@/lib/types";
import DecisionModal from "./DecisionModal";
import {
  acceptAttr, ensureRead, filesFromDir, imageMaxMb, loadWatchHandle,
  matchesExt, suffixesOf, withFileDefaults,
} from "@/lib/files";

type Ongoing = { file_id: string; latency_ms: number | null; ok: boolean };
type Progress = { done: number; total: number; running: boolean };
type Conf = "ALL" | "OK" | "LOW";

function partial(file_id: string, result: Result, reason: string): Decision {
  return {
    file_id, run_id: "", result, reason, findings: [], evidence: {},
    rules_version: "", extraction_method: null, extraction_ok: true,
    extracted: null, latency_ms: null, cost_usd: 0, updated_at: "",
  };
}

function haystack(d: Decision): string {
  const ex = (d.extracted ?? {}) as Record<string, unknown>;
  const ev = (d.evidence ?? {}) as Record<string, unknown>;
  return [
    d.file_id, d.reason, d.result, ...(d.findings || []),
    ex.invoice_number, ex.purchase_order, ex.supplier_tax_id, ex.supplier_iban, ex.total,
    ev.pedido, ev.supplier_id, ev.erp_asiento, ev.erp_status,
  ].map((x) => (x == null ? "" : String(x))).join(" ").toLowerCase();
}

function DecisionCard({ d, onOpen }: { d: Decision; onOpen: () => void }) {
  return (
    <div className="dcard">
      <div className="dcard-head" onClick={onOpen}>
        <div className="dcard-main">
          <div className="dcard-file">{d.file_id}</div>
          <div className="dcard-sub">{d.reason}</div>
        </div>
      </div>
    </div>
  );
}

export default function DecisionBoard() {
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [queued, setQueued] = useState<File[]>([]);
  const [ongoing, setOngoing] = useState<Ongoing[]>([]);
  const [p, setP] = useState<Progress>({ done: 0, total: 0, running: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("ALL");
  const [conf, setConf] = useState<Conf>("ALL");
  const [err, setErr] = useState("");
  const [clearing, setClearing] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const decisionsRef = useRef<Map<string, Decision>>(new Map());
  const runRef = useRef<(files?: File[], inboxOnly?: boolean) => void>(() => {});

  const loadState = useCallback(async () => {
    const snap: StateSnapshot = await fetch("/api/state").then((r) => r.json());
    setDecisions(new Map(snap.decisions.map((d) => [d.file_id, d])));
  }, []);

  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => {
    fetch("/api/policy").then((r) => r.json()).then((p: Policy) => setPolicy(withFileDefaults(p))).catch(() => {});
  }, []);
  useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => {
    if (!policy?.watch.enabled) return;
    const pol = policy;
    let stop = false;
    async function scan() {
      if (stop || runningRef.current) return;
      const handle = await loadWatchHandle();
      if (!handle || stop) return;
      const ok = await ensureRead(handle);
      if (!ok) {
        setErr("No hay permiso para leer la carpeta vigilada.");
        return;
      }
      const files = await filesFromDir(handle, suffixesOf(pol), imageMaxMb(pol));
      const known = new Set<string>([...decisionsRef.current.keys(), ...seenRef.current]);
      const fresh = files.filter((f) => !known.has(f.name));
      if (fresh.length === 0) return;
      for (const f of fresh) seenRef.current.add(f.name);
      runRef.current(fresh, true);
    }
    scan();
    const id = window.setInterval(scan, 4000);
    return () => { stop = true; window.clearInterval(id); };
  }, [policy]);
  runningRef.current = p.running;
  decisionsRef.current = decisions;
  for (const id of decisions.keys()) seenRef.current.add(id);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const exts = policy ? suffixesOf(policy) : [".pdf"];
    const incoming = Array.from(list).filter((f) => matchesExt(f.name, exts));
    setQueued((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      for (const f of incoming) byName.set(f.name, f);
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
    setErr("");
    if (pickRef.current) pickRef.current.value = "";
  }

  function removeQueued(name: string) {
    setQueued((prev) => prev.filter((f) => f.name !== name));
  }

  async function run(files?: File[], inboxOnly = false) {
    const batch = files ?? queued;
    if (p.running || batch.length === 0) return;
    setErr("");
    setOngoing(batch.map((f) => ({ file_id: f.name, latency_ms: null, ok: true })));
    setP({ done: 0, total: batch.length, running: true });

    const form = new FormData();
    for (const f of batch) form.append("files", f);
    const up = await fetch("/api/upload", { method: "POST", body: form });
    if (!up.ok) {
      setErr("No se pudieron cargar los archivos.");
      setP({ done: 0, total: 0, running: false });
      setOngoing([]);
      return false;
    }

    const es = new EventSource(inboxOnly ? "/api/run?inbox=1" : "/api/run");
    esRef.current = es;
    let finished = false;

    es.onmessage = (e) => {
      let m: Record<string, any>;
      try {
        m = JSON.parse(e.data) as Record<string, any>;
      } catch {
        setErr("El servidor envio una respuesta de progreso no valida.");
        return;
      }
      switch (m.event) {
        case "run_start":
          setP({ done: 0, total: m.total, running: true });
          break;
        case "extracted":
          setP((s) => ({ ...s, done: m.i, total: m.total }));
          setOngoing((o) => o.some((x) => x.file_id === m.file_id)
            ? o.map((x) => x.file_id === m.file_id ? { ...x, latency_ms: m.latency_ms, ok: m.ok } : x)
            : [...o, { file_id: m.file_id, latency_ms: m.latency_ms, ok: m.ok }]);
          break;
        case "decided":
          setOngoing((o) => o.filter((x) => x.file_id !== m.file_id));
          setDecisions((prev) => {
            const next = new Map(prev);
            const existing = next.get(m.file_id);
            next.set(m.file_id, existing
              ? { ...existing, result: m.result, reason: m.reason }
              : partial(m.file_id, m.result, m.reason));
            return next;
          });
          break;
        case "closed":
          finished = true;
          es.close();
          esRef.current = null;
          setP((s) => ({ ...s, running: false }));
          setOngoing([]);
          if (m.code === 0) setQueued([]);
          if (m.code !== 0) {
            setErr((current) => current || `El pipeline termino con codigo ${m.code ?? "desconocido"}.`);
          }
          loadState();
          break;
        case "error":
          setErr(String(m.message || `Error en la ejecucion (codigo ${m.code ?? "desconocido"})`));
          break;
        default:
          break;
      }
    };
    es.onerror = () => {
      if (!finished) {
        setErr((current) => current || "Se perdio la conexion con el pipeline antes de recibir el resultado.");
      }
      es.close();
      esRef.current = null;
      setP((s) => ({ ...s, running: false }));
      setOngoing([]);
      loadState();
    };
  }

  runRef.current = run;

  async function clearAll() {
    if (p.running || clearing) return;
    const ok = window.confirm("Se eliminaran todas las decisiones y ejecuciones. Esta accion no se puede deshacer.");
    if (!ok) return;
    setClearing(true);
    setErr("");
    const res = await fetch("/api/state", { method: "DELETE" });
    setClearing(false);
    if (!res.ok) {
      setErr("No se pudo vaciar la base de datos.");
      return;
    }
    setDecisions(new Map());
    setQueued([]);
    setOngoing([]);
    setSelectedId(null);
  }

  const all = useMemo(() => [...decisions.values()], [decisions]);
  const reasons = useMemo(() => {
    const s = new Set(all.map((d) => d.reason).filter(Boolean));
    return [...s].sort();
  }, [all]);

  const needle = q.trim().toLowerCase();
  const match = (d: Decision) => {
    if (reason !== "ALL" && d.reason !== reason) return false;
    if (conf === "OK" && !d.extraction_ok) return false;
    if (conf === "LOW" && d.extraction_ok) return false;
    if (needle && !haystack(d).includes(needle)) return false;
    return true;
  };

  const pagar = all.filter((d) => d.result === "PAGAR" && match(d))
    .sort((a, b) => a.file_id.localeCompare(b.file_id));
  const nopagar = all.filter((d) => d.result === "NO_PAGAR" && match(d))
    .sort((a, b) => a.file_id.localeCompare(b.file_id));
  const revise = all.filter((d) => d.result === "ESCALAR" && match(d))
    .sort((a, b) => a.file_id.localeCompare(b.file_id));
  const ongoingShown = ongoing.filter((o) => !needle || o.file_id.toLowerCase().includes(needle));
  const selected = selectedId ? decisions.get(selectedId) ?? null : null;
  const filtered = pagar.length + nopagar.length + revise.length;
  const filtersOn = Boolean(needle || reason !== "ALL" || conf !== "ALL");

  const auto = Boolean(policy?.watch.enabled);
  const folderName = policy?.watch.folder_name;
  const accept = policy ? acceptAttr(policy) : "application/pdf,.pdf";

  return (
    <>
      <div className="board-head">
        <h1>Facturas</h1>
        <div className="progress-wrap">
          <input
            ref={pickRef}
            type="file"
            accept={accept}
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          {auto ? (
            <span className="chip">{p.running ? `Procesando ${p.done}/${p.total}` : (`Auto - ${folderName || "carpeta"}`)}</span>
          ) : (
            <>
              <button className="btn ghost" onClick={() => pickRef.current?.click()} disabled={p.running}>
                {"A\u00f1adir facturas"}
              </button>
              <button className="btn" onClick={() => run()} disabled={p.running || queued.length === 0}>
                {p.running ? `Procesando ${p.done}/${p.total}` : "Ejecutar lote"}
              </button>
            </>
          )}
          <button className="btn ghost danger" onClick={clearAll} disabled={p.running || clearing || all.length === 0}>
            {clearing ? "Vaciando..." : "Vaciar"}
          </button>
        </div>
      </div>

      <div className="filters">
        <input
          className="search"
          placeholder="Buscar archivo, pedido, NIF, IBAN, motivo..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="ALL">Todos los motivos</option>
          {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="field" value={conf} onChange={(e) => setConf(e.target.value as Conf)}>
          <option value="ALL">{"Toda extracci\u00f3n"}</option>
          <option value="OK">{"Extracci\u00f3n correcta"}</option>
          <option value="LOW">Baja confianza</option>
        </select>
        {filtersOn && (
          <span className="meta">
            {filtered} de {all.length}
          </span>
        )}
      </div>

      {err && <div className="errline">{err}</div>}

      <div className="queue">
        {p.running ? (
          ongoingShown.length === 0
            ? <div className="queue-empty">Preparando lote...</div>
            : ongoingShown.map((o) => (
                <div key={o.file_id} className="qchip live">
                  <span className="spin" />
                  <span className="qname">{o.file_id}</span>
                </div>
              ))
        ) : queued.length === 0 ? (
          <div className="queue-empty">
            {auto
              ? (`Vigilando ${folderName || "la carpeta"}. Los archivos nuevos se procesan solos.`)
              : "Seleccione las facturas que desea analizar."}
          </div>
        ) : (
          queued.map((f) => (
            <div key={f.name} className="qchip">
              <span className="qname">{f.name}</span>
              <button className="qrm" onClick={() => removeQueued(f.name)} aria-label="Quitar">x</button>
            </div>
          ))
        )}
      </div>

      <div className="board">
        <Column title="Pagar" dot="pagar" count={pagar.length}>
          {pagar.length === 0
            ? <div className="col-empty">Sin facturas</div>
            : pagar.map((d) => <DecisionCard key={d.file_id} d={d} onOpen={() => setSelectedId(d.file_id)} />)}
        </Column>

        <Column title="No pagar" dot="nopagar" count={nopagar.length}>
          {nopagar.length === 0
            ? <div className="col-empty">Sin facturas</div>
            : nopagar.map((d) => <DecisionCard key={d.file_id} d={d} onOpen={() => setSelectedId(d.file_id)} />)}
        </Column>

        <Column title="Revisar" dot="revise" count={revise.length}>
          {revise.length === 0
            ? <div className="col-empty">Sin incidencias</div>
            : revise.map((d) => <DecisionCard key={d.file_id} d={d} onOpen={() => setSelectedId(d.file_id)} />)}
        </Column>
      </div>

      {selected && <DecisionModal d={selected} onClose={() => setSelectedId(null)} />}
    </>
  );
}

function Column({ title, dot, count, children }: {
  title: string; dot: string; count: number; children: React.ReactNode;
}) {
  return (
    <div className="col">
      <div className="col-head">
        <div className="col-title">
          <span className={`dot ${dot}`} /> {title}
        </div>
        <span className="count">{count}</span>
      </div>
      <div className="col-body">{children}</div>
    </div>
  );
}
