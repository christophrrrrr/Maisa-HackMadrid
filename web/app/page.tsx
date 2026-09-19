import Link from "next/link";
import { getState } from "@/lib/python";
import { fmtWhen, runErrors, runWarnings, statusLabel, statusTone } from "@/lib/runs";
import type { Decision } from "@/lib/types";
import HomeIssues from "@/components/HomeIssues";
import HomeReviewStatus from "@/components/HomeReviewStatus";

export const dynamic = "force-dynamic";

function urgencyDate(decision: Decision): string {
  const issueDate = decision.extracted?.issue_date;
  return (typeof issueDate === "string" && issueDate) || decision.updated_at || "9999-12-31";
}

function relatedDecision(message: string, decisions: Decision[], runId: string): Decision | null {
  const text = message.toLocaleLowerCase("es");
  const runDecisions = decisions.filter((decision) => decision.run_id === runId);
  const candidates = runDecisions.length ? runDecisions : decisions;

  return candidates.find((decision) => text.includes(decision.file_id.toLocaleLowerCase("es")))
    ?? candidates.find((decision) => {
      const extracted = decision.extracted ?? {};
      const evidence = decision.evidence ?? {};
      return [
        extracted.invoice_number,
        extracted.purchase_order,
        extracted.supplier_tax_id,
        evidence.pedido,
        evidence.supplier_id,
      ].some((value) => {
        const token = value == null ? "" : String(value).trim().toLocaleLowerCase("es");
        return token.length >= 3 && text.includes(token);
      });
    })
    ?? null;
}

export default function HomePage() {
  const { latest_run, recent_runs, summary, decisions } = getState();
  const review = decisions
    .filter((d) => d.result === "ESCALAR")
    .sort((a, b) => urgencyDate(a).localeCompare(urgencyDate(b)));
  const runs = (recent_runs?.length ? recent_runs : latest_run ? [latest_run] : []).slice(0, 5);
  const issues = (recent_runs?.length ? recent_runs : latest_run ? [latest_run] : [])
    .flatMap((run) => [
      ...runErrors(run).map((message) => ({ message, type: "Error" as const, run })),
      ...runWarnings(run).map((message) => ({ message, type: "Aviso" as const, run })),
    ])
    .map((issue) => ({
      ...issue,
      decision: relatedDecision(issue.message, decisions, issue.run.run_id),
    }))
    .slice(0, 8);

  return (
    <div>
      <div className="page-heading">
        <h1>Inicio</h1>
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
        <HomeReviewStatus decisions={review} variant="card" />
      </div>

      <div className="home-actions">
        <Link className="btn" href="/process">Procesar facturas</Link>
        <HomeReviewStatus decisions={review} variant="action" />
      </div>

      <div className="home-grid">
        <section className="card">
          <div className="k">Última ejecución</div>
          {latest_run ? (
            <>
              <div className="home-run-meta">
                <span className={`pill ${statusTone(latest_run.status)}`}>
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
            </>
          ) : (
            <div className="an-empty">Aún no hay ejecuciones registradas.</div>
          )}
        </section>

        <HomeReviewStatus decisions={review} variant="list" />

        <HomeIssues issues={issues} />

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
                    <span className={`pill ${statusTone(run.status)}`}>
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
