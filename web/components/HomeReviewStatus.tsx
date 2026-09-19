"use client";

import Link from "next/link";
import type { Decision } from "@/lib/types";
import { reasonLabel } from "@/lib/reasons";
import { fmtWhen } from "@/lib/runs";
import { useIncidentStatuses } from "@/lib/use-incident-statuses";

type Variant = "card" | "action" | "list";

function invoiceDate(decision: Decision): string | null {
  const value = decision.extracted?.issue_date;
  return typeof value === "string" && value ? value : null;
}

function fmtDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function ReviewRow({ decision }: { decision: Decision }) {
  const issuedAt = invoiceDate(decision);
  return (
    <div className="home-row">
      <div>
        <div className="home-row-title">{decision.file_id}</div>
        <div className="meta">
          {issuedAt
            ? `Factura del ${fmtDate(issuedAt)}`
            : `Pendiente desde ${fmtWhen(decision.updated_at)}`}
          {" \u00b7 "}{reasonLabel(decision.reason)}
        </div>
      </div>
      <span className={`pill ${decision.result}`}>{decision.result}</span>
    </div>
  );
}

export default function HomeReviewStatus({
  decisions,
  variant,
}: {
  decisions: Decision[];
  variant: Variant;
}) {
  const { statusFor, unresolvedCount } = useIncidentStatuses(decisions);
  const unresolved = decisions.filter((decision) => statusFor(decision) !== "resolved").slice(0, 6);

  if (variant === "card") {
    return (
      <Link className="card interactive-card" href="/review">
        <div className="k">En revisi&oacute;n</div>
        <div className="v ESCALAR">{unresolvedCount}</div>
        <div className="sub">requieren inspecci&oacute;n</div>
      </Link>
    );
  }

  if (variant === "action") {
    return (
      <Link className="btn ghost" href="/review">
        Abrir revisi&oacute;n{unresolvedCount ? ` (${unresolvedCount})` : ""}
      </Link>
    );
  }

  return (
    <Link className="card interactive-card" href="/review">
      <div className="k">Pendientes de revisi&oacute;n</div>
      {unresolved.length === 0 ? (
        <div className="an-empty">No hay facturas en revisi&oacute;n.</div>
      ) : (
        <div className="home-list">
          {unresolved.map((decision) => (
            <ReviewRow key={`${decision.run_id}:${decision.file_id}`} decision={decision} />
          ))}
        </div>
      )}
    </Link>
  );
}
