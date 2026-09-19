import Link from "next/link";
import { getState } from "@/lib/python";
import { reasonLabel } from "@/lib/reasons";
import type { Decision, RunRow } from "@/lib/types";

export const dynamic = "force-dynamic";

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function runErrors(run: RunRow | null): string[] {
  if (!run) return [];
  const stats = typeof run.stats === "object" && run.stats ? run.stats : {};
  const raw = (stats as Record<string, unknown>).errors;
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => String(e)).filter(Boolean);
}

function statusLabel(status: string) {
  if (status === "done") return "Completada";
  if (status === "running") return "En curso";
  if (status === "error") return "Error";
  return status;
}

function ReviewRow({ d }: { d: Decision }) {
  return (
    <Link href="/review" className="home-row">
      <div>
        <div className="home-row-title">{d.file_id}</div>
        <div className="meta">{reasonLabel(d.reason)}</div>
      </div>
      <span className={`pill ${d.result}`}>{d.result}</span>
    </Link>
  );
}

export default function HomePage() {
  const { latest_run, recent_runs, summary, decisions } = getState();
  const review = decisions
    .filter((d) => d.result === "ESCALAR")
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .slice(0, 6);
  const errors = runErrors(latest_run);
  const runs = (recent_runs?.length ? recent_runs : latest_run ? [latest_run] : []).slice(0, 5);

  return (
    <div>
      <div className="page-heading">
        <h1>Inicio</h1>
        <div className="subtitle">Estado reciente del procesamiento y alertas</div>
      </div>

      <div className="grid cards">
        <div className="card">
          <div className="k">Total</div>
          <div className="v">{summary.total}</div>
          <div className="sub">facturas en estado actual</div>
        </div>
        <div className="card">
          <div className="k">A pagar</div>
          <div className="v PAGAR">{summary.PAGAR}</div>
          <div className="sub">decisiones automáticas</div>
        </div>
        <div className="card">
          <div className="k">Bloqueadas</div>
          <div className="v NO_PAGAR">{summary.NO_PAGAR}</div>
          <div className="sub">no emitir pago</div>
        </div>
        <div className="card">
          <div className="k">En revisión</div>
          <div className="v ESCALAR">{summary.ESCALAR}</div>
          <div className="sub">requieren inspección</div>
        </div>
      </div>

      <div className="home-actions">
        <Link className="btn" href="/process">Procesar facturas</Link>
        <Link className="btn ghost" href="/review">
          Abrir revisión{summary.ESCALAR ? ` (${summary.ESCALAR})` : ""}
        </Link>
      </div>

      <div className="home-grid">
        <section className="card">
          <div className="k">Última ejecución</div>
          {latest_run ? (
            <>
              <div className="home-run-meta">
                <span className={`pill ${latest_run.status === "error" ? "ESCALAR" : latest_run.status === "done" ? "PAGAR" : "NO_PAGAR"}`}>
                  {statusLabel(latest_run.status)}
                </span>
                <span className="meta">{fmtWhen(latest_run.started_at)}</span>
              </div>
              <div className="kv home-kv">
                <div className="k">Archivos</div>
                <div>{latest_run.total}</div>
                <div className="k">Resultados</div>
                <div>{latest_run.n_pagar} pagar · {latest_run.n_no_pagar} no pagar · {latest_run.n_escalar} revisar</div>
                <div className="k">Duración</div>
                <div>{latest_run.elapsed_s != null ? `${latest_run.elapsed_s.toFixed(1)} s` : "—"}</div>
              </div>
              {errors.length > 0 && (
                <div className="home-errors">
                  <div className="section-title" style={{ marginTop: 16 }}>Errores del lote</div>
                  {errors.map((err) => (
                    <div key={err} className="errline">{err}</div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="an-empty">Aún no hay ejecuciones registradas.</div>
          )}
        </section>

        <section className="card">
          <div className="k">Pendientes de revisión</div>
          {review.length === 0 ? (
            <div className="an-empty">No hay facturas en revisión.</div>
          ) : (
            <div className="home-list">
              {review.map((d) => <ReviewRow key={d.file_id} d={d} />)}
            </div>
          )}
        </section>

        <section className="card home-span">
          <div className="k">Actividad reciente</div>
          {runs.length === 0 ? (
            <div className="an-empty">Sin actividad todavía.</div>
          ) : (
            <div className="home-list">
              {runs.map((run) => {
                const runErrs = runErrors(run);
                return (
                  <div key={run.run_id} className="home-row static">
                    <div>
                      <div className="home-row-title">{fmtWhen(run.started_at)}</div>
                      <div className="meta">
                        {run.total} archivos · {run.n_escalar} en revisión
                        {runErrs.length ? ` · ${runErrs.length} error${runErrs.length === 1 ? "" : "es"}` : ""}
                      </div>
                    </div>
                    <span className={`pill ${run.status === "error" ? "ESCALAR" : run.status === "done" ? "PAGAR" : "NO_PAGAR"}`}>
                      {statusLabel(run.status)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
