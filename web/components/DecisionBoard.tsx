"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Decision, Result, StateSnapshot } from "@/lib/types";
import DecisionTrace from "./DecisionTrace";

type Ongoing = { file_id: string; latency_ms: number | null; ok: boolean };
type Progress = { done: number; total: number; running: boolean };

function partial(file_id: string, result: Result, reason: string): Decision {
  return {
    file_id, run_id: "", result, reason, findings: [], evidence: {},
    rules_version: "", extraction_method: null, extraction_ok: true,
    extracted: null, latency_ms: null, cost_usd: 0, updated_at: "",
  };
}

function DecisionCard({ d, open, onToggle }: { d: Decision; open: boolean; onToggle: () => void }) {
  return (
    <div className={`dcard ${open ? "open" : ""}`}>
      <div className="dcard-head" onClick={onToggle}>
        <span className={`pill ${d.result}`}>{d.result}</span>
        <div className="dcard-main">
          <div className="dcard-file">{d.file_id}</div>
          <div className="dcard-sub">{d.reason}</div>
        </div>
        <span className="dcard-caret">&#9656;</span>
      </div>
      {open && <DecisionTrace d={d} />}
    </div>
  );
}

export default function DecisionBoard() {
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [queued, setQueued] = useState<File[]>([]);
  const [ongoing, setOngoing] = useState<Ongoing[]>([]);
  const [p, setP] = useState<Progress>({ done: 0, total: 0, running: false });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);

  const loadState = useCallback(async () => {
    const snap: StateSnapshot = await fetch("/api/state").then((r) => r.json());
    setDecisions(new Map(snap.decisions.map((d) => [d.file_id, d])));
  }, []);

  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => () => esRef.current?.close(), []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
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

  async function run() {
    if (p.running || queued.length === 0) return;
    setErr("");
    setOngoing(queued.map((f) => ({ file_id: f.name, latency_ms: null, ok: true })));
    setP({ done: 0, total: queued.length, running: true });

    const form = new FormData();
    for (const f of queued) form.append("files", f);
    const up = await fetch("/api/upload", { method: "POST", body: form });
    if (!up.ok) {
      setErr("No se pudieron cargar los archivos.");
      setP({ done: 0, total: 0, running: false });
      setOngoing([]);
      return;
    }

    const es = new EventSource("/api/run");
    esRef.current = es;

    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
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
          es.close();
          esRef.current = null;
          setP((s) => ({ ...s, running: false }));
          setOngoing([]);
          setQueued([]);
          loadState();
          break;
        case "error":
          setErr(String(m.message || "Error en la ejecucion"));
          break;
        default:
          break;
      }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setP((s) => ({ ...s, running: false }));
      setOngoing([]);
      loadState();
    };
  }

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const all = useMemo(() => [...decisions.values()], [decisions]);
  const needle = q.trim().toLowerCase();
  const match = (d: Decision) => !needle ||
    d.file_id.toLowerCase().includes(needle) || d.reason.toLowerCase().includes(needle);

  const done = all.filter((d) => (d.result === "PAGAR" || d.result === "NO_PAGAR") && match(d))
    .sort((a, b) => a.file_id.localeCompare(b.file_id));
  const revise = all.filter((d) => d.result === "ESCALAR" && match(d))
    .sort((a, b) => a.file_id.localeCompare(b.file_id));
  const ongoingShown = ongoing.filter((o) => !needle || o.file_id.toLowerCase().includes(needle));

  return (
    <>
      <div className="board-head">
        <h1 style={{ margin: 0 }}>Decisiones</h1>
        <div className="progress-wrap">
          <input className="search" placeholder="Buscar archivo o motivo..." value={q} onChange={(e) => setQ(e.target.value)} />
          <input
            ref={pickRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          <button className="btn ghost" onClick={() => pickRef.current?.click()} disabled={p.running}>
            {"A\u00f1adir facturas"}
          </button>
          <button className="btn" onClick={run} disabled={p.running || queued.length === 0}>
            {p.running ? `Procesando ${p.done}/${p.total}` : "Ejecutar lote"}
          </button>
        </div>
      </div>

      {err && <div className="errline">{err}</div>}

      <div className="queue">
        {queued.length === 0 ? (
          <div className="queue-empty">Seleccione las facturas que desea analizar.</div>
        ) : (
          queued.map((f) => (
            <div key={f.name} className="qchip">
              <span className="qname">{f.name}</span>
              {!p.running && (
                <button className="qrm" onClick={() => removeQueued(f.name)} aria-label="Quitar">x</button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="board">
        <Column title="En curso" dot="ongoing" count={ongoingShown.length}>
          {ongoingShown.length === 0
            ? <div className="col-empty">{p.running ? "Preparando..." : "Sin archivos en proceso"}</div>
            : ongoingShown.map((o) => (
                <div key={o.file_id} className="dcard">
                  <div className="dcard-head" style={{ cursor: "default" }}>
                    <span className="spin" />
                    <div className="dcard-main">
                      <div className="dcard-file">{o.file_id}</div>
                      <div className="dcard-sub">
                        {o.ok ? "Analizando" : "Baja confianza"}
                        {o.latency_ms != null ? `  - ${o.latency_ms} ms` : ""}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
        </Column>

        <Column title="Resuelto" dot="done" count={done.length} sub="pagar / no pagar">
          {done.length === 0
            ? <div className="col-empty">Sin decisiones</div>
            : done.map((d) => <DecisionCard key={d.file_id} d={d} open={open.has(d.file_id)} onToggle={() => toggle(d.file_id)} />)}
        </Column>

        <Column title="Revisar" dot="revise" count={revise.length} sub="escalar">
          {revise.length === 0
            ? <div className="col-empty">Sin incidencias</div>
            : revise.map((d) => <DecisionCard key={d.file_id} d={d} open={open.has(d.file_id)} onToggle={() => toggle(d.file_id)} />)}
        </Column>
      </div>
    </>
  );
}

function Column({ title, dot, count, sub, children }: {
  title: string; dot: string; count: number; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="col">
      <div className="col-head">
        <div className="col-title">
          <span className={`dot ${dot}`} /> {title}
          {sub && <span className="faint" style={{ fontWeight: 400, fontSize: 11 }}>{sub}</span>}
        </div>
        <span className="count">{count}</span>
      </div>
      <div className="col-body">{children}</div>
    </div>
  );
}
