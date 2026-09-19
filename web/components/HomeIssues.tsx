"use client";

import Link from "next/link";
import { useState } from "react";
import type { Decision, RunRow } from "@/lib/types";
import { batchLabel, fmtWhen } from "@/lib/runs";
import DecisionModal from "./DecisionModal";

export interface HomeIssue {
  message: string;
  type: "Error" | "Aviso";
  run: RunRow;
  decision: Decision | null;
}

export default function HomeIssues({ issues }: { issues: HomeIssue[] }) {
  const [selected, setSelected] = useState<Decision | null>(null);

  return (
    <>
      <section className="card home-span">
        <div className="k">Errores e incidencias</div>
        {issues.length === 0 ? (
          <div className="an-empty">No se han registrado errores ni incidencias.</div>
        ) : (
          <div className="home-list">
            {issues.map(({ message, type, run, decision }, index) => {
              const content = (
                <>
                  <div>
                    <div className="home-row-title">{message}</div>
                    <div className="meta">
                      {fmtWhen(run.started_at)} {"\u00b7"} {batchLabel(run)}
                      {" \u00b7 "}{decision ? `Ver factura ${decision.file_id}` : "Ver ejecuci\u00f3n"}
                    </div>
                  </div>
                  <span className={`pill ${type === "Error" ? "ESCALAR" : "NO_PAGAR"}`}>{type}</span>
                </>
              );

              return decision ? (
                <button
                  key={`${run.run_id}-${type}-${index}`}
                  type="button"
                  className="home-row home-row-button"
                  onClick={() => setSelected(decision)}
                >
                  {content}
                </button>
              ) : (
                <Link
                  key={`${run.run_id}-${type}-${index}`}
                  className="home-row"
                  href={`/insights?run=${encodeURIComponent(run.run_id)}`}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {selected && <DecisionModal d={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
