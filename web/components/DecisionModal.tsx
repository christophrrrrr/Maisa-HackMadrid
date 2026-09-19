"use client";

import { useEffect, useState } from "react";
import type { Decision } from "@/lib/types";
import DecisionTrace from "./DecisionTrace";
import IncidentResolver from "./IncidentResolver";
import { previewKind } from "@/lib/files";
import { reasonLabel } from "@/lib/reasons";

export default function DecisionModal({ d, onClose }: { d: Decision; onClose: () => void }) {
  const [showResolver, setShowResolver] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const src = `/api/pdf/${encodeURIComponent(d.file_id)}`;
  const kind = previewKind(d.file_id);

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="dcard-main">
            <div className="modal-file">{d.file_id}</div>
            <div className="dcard-sub">{reasonLabel(d.reason) || "sin motivo"}</div>
          </div>
          {d.result === "ESCALAR" ? (
            <button className="btn" onClick={() => setShowResolver(true)}>Resolver incidencia</button>
          ) : (
            <span className={`pill ${d.result}`}>{d.result}</span>
          )}
          <button className="btn ghost sm" onClick={onClose}>Cerrar</button>
        </div>
        <div className="modal-split">
          <div className="pdf-pane">
            {kind === "image" ? (
              <img className="pdf-img" alt={d.file_id} src={src} />
            ) : (
              <iframe className="pdf-frame" title={d.file_id} src={src} />
            )}
          </div>
          <div className="modal-body">
            {showResolver && <IncidentResolver d={d} onClose={() => setShowResolver(false)} />}
            <DecisionTrace d={d} />
          </div>
        </div>
      </div>
    </div>
  );
}
