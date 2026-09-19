"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Result, RunDiff, RunRow } from "@/lib/types";
import { reasonLabel } from "@/lib/reasons";

function fmtWhen(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function runLabel(r: RunRow): string {
  const parts = [r.batch, r.rules_version, fmtWhen(r.started_at)].filter(Boolean);
  return `${parts.join(" \u00b7 ")} \u00b7 ${r.total} facturas`;
}

function fileHref(fileId: string): string {
  return `/review?file=${encodeURIComponent(fileId)}`;
}

function Pill({ result }: { result: Result }) {
  return <span className={`pill ${result}`}>{result}</span>;
}

export default function ChangeDiff() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((rows: RunRow[]) => {
        setRuns(rows);
        // default: compare the two most recent runs, oldest as "before"
        if (rows.length >= 2) {
          setBId(rows[0].run_id);   // newest = after
          setAId(rows[1].run_id);   // previous = before
        }
      })
      .catch(() => setErr("No se pudieron cargar las ejecuciones."));
  }, []);

  const loadDiff = useCallback(async (a: string, b: string) => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
      if (!res.ok) throw new Error(String(res.status));
      setDiff((await res.json()) as RunDiff);
    } catch {
      setErr("No se pudo calcular la comparaci\u00f3n.");
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (aId && bId && aId !== bId) loadDiff(aId, bId);
    else setDiff(null);
  }, [aId, bId, loadDiff]);

  const summaryCards = useMemo(() => {
    if (!diff) return [];
    const s = diff.summary;
    return [
      { k: "Cambios de decisi\u00f3n", v: s.result_changed, tone: "" },
      { k: "Cambios de motivo", v: s.reason_changed, tone: "" },
      { k: "Nuevas", v: s.added, tone: "PAGAR" },
      { k: "Retiradas", v: s.removed, tone: "ESCALAR" },
    ];
  }, [diff]);

  if (runs.length < 2) {
    return (
      <div>
        <h1>Cambios entre ejecuciones</h1>
        <div className="subtitle" style={{ marginTop: 4 }}>
          {"Compara dos ejecuciones y descubre qu\u00e9 decisiones cambiaron y por qu\u00e9."}
        </div>
        <div className="card" style={{ marginTop: 20 }}>
          <div className="an-empty">
            {"Se necesitan al menos dos ejecuciones para comparar. Ejecuta un lote nuevo "}
            {"(por ejemplo lote2, la norma v4, o tras actualizar el ERP o el maestro) y vuelve aqu\u00ed."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Cambios entre ejecuciones</h1>
      <div className="subtitle" style={{ marginTop: 4 }}>
        {"Qu\u00e9 decisiones se movieron entre dos ejecuciones y por qu\u00e9 (norma, ERP o maestro)."}
      </div>

      <div className="cd-pickers">
        <label className="cd-pick">
          <span>Antes (A)</span>
          <select className="field" value={aId} onChange={(e) => setAId(e.target.value)}>
            {runs.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r)}</option>)}
          </select>
        </label>
        <span className="cd-vs" aria-hidden="true">{"\u2192"}</span>
        <label className="cd-pick">
          <span>{"Despu\u00e9s (B)"}</span>
          <select className="field" value={bId} onChange={(e) => setBId(e.target.value)}>
            {runs.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r)}</option>)}
          </select>
        </label>
      </div>

      {aId === bId && (
        <div className="errline">Elige dos ejecuciones distintas para comparar.</div>
      )}
      {err && <div className="errline">{err}</div>}
      {loading && <div className="subtitle">{"Calculando comparaci\u00f3n..."}</div>}

      {diff && !loading && (
        <>
          <div className="grid cards" style={{ marginTop: 20 }}>
            {summaryCards.map((c) => (
              <div className="card" key={c.k}>
                <div className="k">{c.k}</div>
                <div className={`v ${c.tone}`}>{c.v}</div>
              </div>
            ))}
          </div>

          {diff.transitions.length > 0 && (
            <>
              <div className="section-title">Movimientos</div>
              <div className="cd-trans">
                {diff.transitions.map((t) => (
                  <span className="cd-tchip" key={`${t.from}-${t.to}`}>
                    <Pill result={t.from} />{" \u2192 "}<Pill result={t.to} />
                    <b>{t.count}</b>
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="section-title">{"Cambios de decisi\u00f3n"}</div>
          {diff.result_changes.length === 0 ? (
            <div className="card"><div className="an-empty">{"Ninguna decisi\u00f3n cambi\u00f3 entre estas ejecuciones."}</div></div>
          ) : (
            <div className="card hist-card">
              <div className="hist-scroll">
                <table className="hist-table">
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Antes</th>
                      <th>Motivo (antes)</th>
                      <th>{"Despu\u00e9s"}</th>
                      <th>{"Motivo (despu\u00e9s)"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.result_changes.map((c) => (
                      <tr key={c.file_id}>
                        <td className="mono hist-file">
                          <a href={fileHref(c.file_id)} title="Ver traza">{c.file_id}</a>
                        </td>
                        <td><Pill result={c.from.result} /></td>
                        <td className="muted">{reasonLabel(c.from.reason)}</td>
                        <td><Pill result={c.to.result} /></td>
                        <td className="muted">{reasonLabel(c.to.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {diff.reason_changes.length > 0 && (
            <details className="cd-details">
              <summary>
                {"Cambios de motivo (misma decisi\u00f3n)"}
                <span>{diff.reason_changes.length}</span>
              </summary>
              <div className="card hist-card" style={{ marginTop: 12 }}>
                <div className="hist-scroll">
                  <table className="hist-table">
                    <thead>
                      <tr>
                        <th>Archivo</th>
                        <th>{"Decisi\u00f3n"}</th>
                        <th>Motivo (antes)</th>
                        <th>{"Motivo (despu\u00e9s)"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.reason_changes.map((c) => (
                        <tr key={c.file_id}>
                          <td className="mono hist-file">
                            <a href={fileHref(c.file_id)} title="Ver traza">{c.file_id}</a>
                          </td>
                          <td><Pill result={c.result} /></td>
                          <td className="muted">{reasonLabel(c.from_reason)}</td>
                          <td className="muted">{reasonLabel(c.to_reason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}

          {(diff.added.length > 0 || diff.removed.length > 0) && (
            <details className="cd-details">
              <summary>
                Facturas nuevas / retiradas
                <span>{diff.added.length + diff.removed.length}</span>
              </summary>
              <div className="cd-lists">
                <div>
                  <div className="k" style={{ marginBottom: 8 }}>Nuevas en B ({diff.added.length})</div>
                  <div className="findings">
                    {diff.added.length === 0
                      ? <span className="faint">ninguna</span>
                      : diff.added.map((f) => (
                          <a key={f} className="chip" href={fileHref(f)}>{f}</a>
                        ))}
                  </div>
                </div>
                <div>
                  <div className="k" style={{ marginBottom: 8 }}>Retiradas en B ({diff.removed.length})</div>
                  <div className="findings">
                    {diff.removed.length === 0
                      ? <span className="faint">ninguna</span>
                      : diff.removed.map((f) => <span key={f} className="chip">{f}</span>)}
                  </div>
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
