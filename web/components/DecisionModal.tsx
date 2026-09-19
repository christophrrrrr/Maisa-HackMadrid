"use client";

import { useEffect } from "react";
import type { Decision } from "@/lib/types";
import DecisionTrace from "./DecisionTrace";

export default function DecisionModal({ d, onClose }: { d: Decision; onClose: () => void }) {
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

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="dcard-main">
            <div className="modal-file">{d.file_id}</div>
            <div className="dcard-sub">{d.reason || "sin motivo"}</div>
          </div>
          <span className={`pill ${d.result}`}>{d.result}</span>
          <button className="btn ghost sm" onClick={onClose}>Cerrar</button>
        </div>
        <div className="modal-body">
          <DecisionTrace d={d} />
        </div>
      </div>
    </div>
  );
}
