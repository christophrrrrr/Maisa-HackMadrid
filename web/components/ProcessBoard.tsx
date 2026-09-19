"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Policy, RunRow, ScheduledJob, StateSnapshot } from "@/lib/types";
import { fmtWhen, runErrors, statusLabel, statusTone } from "@/lib/runs";
import {
  acceptAttr, ensureRead, filesFromDir, imageMaxMb, loadWatchHandle,
  matchesExt, pickDirectory, saveWatchHandle, suffixesOf, withFileDefaults,
} from "@/lib/files";

type Ongoing = { file_id: string; latency_ms: number | null; ok: boolean };
type Progress = { done: number; total: number; running: boolean };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function finishRun(
  es: EventSource,
  esRef: { current: EventSource | null },
  runningRef: { current: boolean },
  setP: (fn: (s: Progress) => Progress) => void,
  setOngoing: (v: Ongoing[]) => void,
) {
  es.close();
  esRef.current = null;
  runningRef.current = false;
  setP((s) => ({ ...s, running: false }));
  setOngoing([]);
}

export default function ProcessBoard() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [queued, setQueued] = useState<File[]>([]);
  const [ongoing, setOngoing] = useState<Ongoing[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([]);
  const [p, setP] = useState<Progress>({ done: 0, total: 0, running: false });
  const [when, setWhen] = useState("");
  const [forceVision, setForceVision] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [err, setErr] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const knownRef = useRef<Set<string>>(new Set());
  const firingRef = useRef(false);
  const runRef = useRef<(files?: File[], ready?: boolean) => Promise<void>>(async () => {});

  const loadState = useCallback(async () => {
    const snap: StateSnapshot = await fetch("/api/state").then((r) => r.json());
    setRuns(snap.recent_runs ?? []);
    knownRef.current = new Set(snap.decisions.map((d) => d.file_id));
    for (const id of knownRef.current) seenRef.current.add(id);
  }, []);

  const loadScheduled = useCallback(async () => {
    const data = await fetch("/api/schedule").then((r) => r.json()) as { jobs?: ScheduledJob[] };
    setScheduled(data.jobs ?? []);
  }, []);

  useEffect(() => { loadState(); loadScheduled(); }, [loadState, loadScheduled]);
  useEffect(() => {
    fetch("/api/policy").then((r) => r.json()).then((pol: Policy) => setPolicy(withFileDefaults(pol))).catch(() => {});
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
      const known = new Set<string>([...knownRef.current, ...seenRef.current]);
      const fresh = files.filter((f) => !known.has(f.name));
      if (fresh.length === 0) return;
      for (const f of fresh) seenRef.current.add(f.name);
      runRef.current(fresh);
    }
    scan();
    const id = window.setInterval(scan, 4000);
    return () => { stop = true; window.clearInterval(id); };
  }, [policy]);

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

  async function run(files?: File[], ready = false) {
    const batch = files ?? queued;
    const clearQueue = files === undefined && !ready;
    if (runningRef.current || (!ready && batch.length === 0)) return;
    runningRef.current = true;
    setErr("");
    setOngoing(batch.map((f) => ({ file_id: f.name, latency_ms: null, ok: true })));
    setP({ done: 0, total: batch.length, running: true });

    if (!ready) {
      const form = new FormData();
      for (const f of batch) form.append("files", f);
      const up = await fetch("/api/upload", { method: "POST", body: form });
      if (!up.ok) {
        setErr("No se pudieron cargar los archivos.");
        setP({ done: 0, total: 0, running: false });
        setOngoing([]);
        runningRef.current = false;
        return;
      }
    }

    await new Promise<void>((resolve) => {
      const es = new EventSource(forceVision ? "/api/run?inbox=1&force=1" : "/api/run?inbox=1");
      esRef.current = es;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        finishRun(es, esRef, runningRef, setP, setOngoing);
        resolve();
      };

      es.onmessage = (e) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(e.data) as Record<string, unknown>;
        } catch {
          setErr("El servidor envi\u00f3 una respuesta de progreso no v\u00e1lida.");
          return;
        }
        switch (m.event) {
          case "run_start":
            setP({ done: 0, total: Number(m.total) || 0, running: true });
            break;
          case "extracted": {
            const fileId = String(m.file_id || "");
            const next = { file_id: fileId, latency_ms: Number(m.latency_ms) || null, ok: Boolean(m.ok) };
            setP((s) => ({ ...s, done: Number(m.i) || s.done, total: Number(m.total) || s.total }));
            setOngoing((o) => o.some((x) => x.file_id === fileId)
              ? o.map((x) => x.file_id === fileId ? next : x)
              : [...o, next]);
            break;
          }
          case "decided":
            knownRef.current.add(String(m.file_id || ""));
            setOngoing((o) => o.filter((x) => x.file_id !== String(m.file_id || "")));
            break;
          case "closed":
            if (m.code === 0 && clearQueue) setQueued([]);
            if (m.code !== 0) {
              setErr((current) => current || `El pipeline termin\u00f3 con c\u00f3digo ${m.code ?? "desconocido"}.`);
            }
            loadState();
            done();
            break;
          case "error":
            setErr(String(m.message || `Error en la ejecuci\u00f3n (c\u00f3digo ${m.code ?? "desconocido"})`));
            break;
          default:
            break;
        }
      };
      es.onerror = () => {
        if (!finished) {
          setErr((current) => current || "Se perdi\u00f3 la conexi\u00f3n con el pipeline antes de recibir el resultado.");
          loadState();
        }
        done();
      };
    });
  }

  runRef.current = run;

  useEffect(() => {
    let stop = false;
    async function tick() {
      if (stop || runningRef.current || firingRef.current) return;
      const due = scheduled.find((job) => new Date(job.when).getTime() <= Date.now());
      if (!due) return;
      firingRef.current = true;
      setErr("");
      const res = await fetch("/api/schedule/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: due.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErr(body.error || "No se pudo lanzar el lote programado.");
        firingRef.current = false;
        loadScheduled();
        return;
      }
      await loadScheduled();
      await runRef.current([], true);
      firingRef.current = false;
    }
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { stop = true; window.clearInterval(id); };
  }, [scheduled, loadScheduled]);

  async function scheduleBatch() {
    if (p.running || scheduling || queued.length === 0 || !when) return;
    const at = new Date(when);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      setErr("Elija una fecha y hora futuras.");
      return;
    }
    setScheduling(true);
    setErr("");
    const form = new FormData();
    for (const f of queued) form.append("files", f);
    form.append("when", at.toISOString());
    const res = await fetch("/api/schedule", { method: "POST", body: form });
    setScheduling(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setErr(body.error || "No se pudo programar el lote.");
      return;
    }
    setQueued([]);
    setWhen("");
    loadScheduled();
  }

  async function deleteBatch(runId: string) {
    if (p.running || deleting) return;
    const ok = window.confirm("Se eliminar\u00e1 este lote y sus decisiones. Esta acci\u00f3n no se puede deshacer.");
    if (!ok) return;
    setDeleting(runId);
    setErr("");
    const res = await fetch(`/api/state?run_id=${encodeURIComponent(runId)}`, { method: "DELETE" });
    setDeleting(null);
    if (!res.ok) {
      setErr("No se pudo eliminar el lote.");
      return;
    }
    loadState();
  }

  async function cancelScheduled(id: string) {
    if (deleting) return;
    setDeleting(id);
    setErr("");
    const res = await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setDeleting(null);
    if (!res.ok) {
      setErr("No se pudo eliminar el lote programado.");
      return;
    }
    loadScheduled();
  }

  async function changeFolder() {
    if (p.running) return;
    setErr("");
    const handle = await pickDirectory();
    if (!handle) {
      if (!("showDirectoryPicker" in window)) {
        setErr("El selector de carpeta requiere Chrome o Edge.");
      }
      return;
    }
    await saveWatchHandle(handle);
    const updated: Policy = await fetch("/api/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watch: { enabled: true, folder_name: handle.name } }),
    }).then((r) => r.json()).then(withFileDefaults);
    setPolicy(updated);
    seenRef.current = new Set(knownRef.current);
  }

  const auto = Boolean(policy?.watch.enabled);
  const folderName = policy?.watch.folder_name;
  const accept = policy ? acceptAttr(policy) : "application/pdf,.pdf";
  const minWhen = toLocalInput(new Date(Date.now() + 60_000));
  const history = [
    ...scheduled.map((job) => ({ kind: "scheduled" as const, at: job.when, job })),
    ...runs.map((run) => ({ kind: "run" as const, at: run.started_at, run })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="process-page">
      <div className="page-heading">
        <h1>Procesar</h1>
        <div className="subtitle">Lotes manuales, programados y carpeta vigilada</div>
      </div>

      {auto && (
        <div className="card">
          <div className="folder-picker watch-box">
            <div className="folder-mark" aria-hidden="true" />
            <div>
              <strong>Vigilando {folderName || "la carpeta"}</strong>
              <span>Los archivos nuevos se procesan solos.</span>
            </div>
            <div className="process-watch-actions">
              {p.running && <span className="chip">Procesando {p.done}/{p.total}</span>}
              <button
                type="button"
                className="btn ghost sm"
                onClick={changeFolder}
                disabled={p.running}
              >
                Cambiar
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <div className="process-card-head">
          <div>
            <div className="k">Lote manual</div>
            <div className="sub">Seleccione archivos y ejecute ahora o programe una hora.</div>
          </div>
          <div className="process-actions">
            <input
              ref={pickRef}
              type="file"
              accept={accept}
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <button className="btn ghost" onClick={() => pickRef.current?.click()} disabled={p.running}>
              A&ntilde;adir facturas
            </button>
            <button className="btn" onClick={() => run()} disabled={p.running || queued.length === 0}>
              {p.running ? `Procesando ${p.done}/${p.total}` : "Ejecutar lote"}
            </button>
          </div>
        </div>

        <label className="process-cache-toggle">
          <input
            type="checkbox"
            checked={forceVision}
            onChange={(e) => setForceVision(e.target.checked)}
            disabled={p.running}
          />
          Volver a extraer (ignorar caché de visión)
        </label>

        <div className="queue process-queue">
          {p.running ? (
            ongoing.length === 0
              ? <div className="queue-empty">Preparando lote...</div>
              : ongoing.map((o) => (
                  <div key={o.file_id} className="qchip live">
                    <span className="spin" />
                    <span className="qname">{o.file_id}</span>
                  </div>
                ))
          ) : queued.length === 0 ? (
            <div className="queue-empty">Seleccione las facturas que desea analizar.</div>
          ) : (
            queued.map((f) => (
              <div key={f.name} className="qchip">
                <span className="qname">{f.name}</span>
                <button className="qrm" onClick={() => removeQueued(f.name)} aria-label="Quitar">x</button>
              </div>
            ))
          )}
        </div>

        <div className="process-schedule">
          <label className="process-schedule-label" htmlFor="schedule-when">Programar para</label>
          <input
            id="schedule-when"
            className="field"
            type="datetime-local"
            min={minWhen}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            disabled={p.running}
          />
          <button
            className="btn ghost"
            onClick={scheduleBatch}
            disabled={p.running || scheduling || queued.length === 0 || !when}
          >
            {scheduling ? "Programando..." : "Programar"}
          </button>
          <span className="meta">Se dispara con la consola abierta.</span>
        </div>
      </section>

      {err && <div className="errline">{err}</div>}

      <section className="card">
        <div className="k">Historial de lotes</div>
        {history.length === 0 ? (
          <div className="an-empty">A&uacute;n no hay ejecuciones registradas.</div>
        ) : (
          <div className="home-list">
            {history.map((item) => {
              if (item.kind === "scheduled") {
                const job = item.job;
                return (
                  <div key={job.id} className="home-row static">
                    <div>
                      <div className="home-row-title">{fmtWhen(job.when)}</div>
                      <div className="meta">
                        {job.files.length} archivo{job.files.length === 1 ? "" : "s"}
                        {job.files.length ? ` \u00b7 ${job.files.slice(0, 3).join(", ")}` : ""}
                        {job.files.length > 3 ? ` +${job.files.length - 3}` : ""}
                      </div>
                    </div>
                    <div className="process-row-actions">
                      <span className={`pill ${statusTone("scheduled")}`}>{statusLabel("scheduled")}</span>
                      <button
                        className="btn ghost danger sm"
                        onClick={() => cancelScheduled(job.id)}
                        disabled={p.running || deleting === job.id}
                      >
                        {deleting === job.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    </div>
                  </div>
                );
              }
              const row = item.run;
              const errors = runErrors(row);
              return (
                <div key={row.run_id} className="home-row static">
                  <Link
                    className="process-run-link"
                    href={`/history?run=${encodeURIComponent(row.run_id)}`}
                  >
                    <div>
                      <div className="home-row-title">{fmtWhen(row.started_at)}</div>
                      <div className="meta">
                        {row.total} archivos &middot; {row.n_pagar} pagar &middot; {row.n_no_pagar} no pagar &middot; {row.n_escalar} en revisi&oacute;n
                        {row.elapsed_s != null ? ` \u00b7 ${row.elapsed_s.toFixed(1)} s` : ""}
                        {errors.length ? ` \u00b7 ${errors.length} error${errors.length === 1 ? "" : "es"}` : ""}
                      </div>
                    </div>
                    <span className={`pill ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
                  </Link>
                  <div className="process-row-actions">
                    <button
                      className="btn ghost danger sm"
                      onClick={() => deleteBatch(row.run_id)}
                      disabled={p.running || deleting === row.run_id}
                    >
                      {deleting === row.run_id ? "Eliminando..." : "Eliminar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
