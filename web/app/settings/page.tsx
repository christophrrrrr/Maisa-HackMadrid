"use client";

import { useEffect, useMemo, useState } from "react";
import type { Policy, Result } from "@/lib/types";

const RESULTS: Result[] = ["PAGAR", "NO_PAGAR", "ESCALAR"];

function fromIso(iso: string | null): { d: string; m: string; y: string } {
  if (!iso) return { d: "", m: "", y: "" };
  const [y, m, d] = iso.split("-");
  return { d: d ?? "", m: m ?? "", y: y ?? "" };
}

function toIso(d: string, m: string, y: string): string | null {
  if (!d && !m && !y) return null;
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  const nD = Number(dd);
  const nM = Number(mm);
  const nY = Number(y);
  if (nM < 1 || nM > 12 || nD < 1 || nD > 31) return null;
  return `${y}-${mm}-${dd}`;
}

export default function Settings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [date, setDate] = useState({ d: "", m: "", y: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/policy").then((r) => r.json()).then((p: Policy) => {
      setPolicy(p);
      setDraft(p);
      setDate(fromIso(p.today));
    });
  }, []);

  const dirty = useMemo(() => {
    if (!policy || !draft) return false;
    const today = toIso(date.d, date.m, date.y);
    return policy.tolerance !== draft.tolerance
      || (policy.today ?? null) !== (today ?? null)
      || JSON.stringify(policy.reason_outcomes) !== JSON.stringify(draft.reason_outcomes);
  }, [policy, draft, date]);

  function patch(p: Partial<Policy>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setSaved(false);
  }
  function setOutcome(code: string, outcome: Result) {
    setDraft((d) => (d ? { ...d, reason_outcomes: { ...d.reason_outcomes, [code]: outcome } } : d));
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    const today = toIso(date.d, date.m, date.y);
    if ((date.d || date.m || date.y) && !today) return;
    setSaving(true);
    const body = {
      tolerance: draft.tolerance,
      today,
      reason_outcomes: draft.reason_outcomes,
    };
    const updated: Policy = await fetch("/api/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    setPolicy(updated);
    setDraft(updated);
    setDate(fromIso(updated.today));
    setSaving(false);
    setSaved(true);
  }

  if (!draft) return <div className="muted">{"Cargando configuraci\u00f3n..."}</div>;

  const codes = Object.keys(draft.reason_outcomes);
  const dateInvalid = Boolean((date.d || date.m || date.y) && !toIso(date.d, date.m, date.y));

  return (
    <>
      <h1 style={{ margin: "0 0 18px" }}>{"Configuraci\u00f3n"}</h1>

      <div className="section-title">{"Ejecuci\u00f3n"}</div>
      <div className="card compact">
        <div className="setrow">
          <div>
            <div className="lbl">Fecha de referencia</div>
          </div>
          <div className="date3">
            <input
              className="field" inputMode="numeric" maxLength={2} placeholder="dd" style={{ width: 52 }}
              value={date.d} onChange={(e) => { setDate((x) => ({ ...x, d: e.target.value.replace(/\D/g, "") })); setSaved(false); }}
            />
            <span>/</span>
            <input
              className="field" inputMode="numeric" maxLength={2} placeholder="mm" style={{ width: 52 }}
              value={date.m} onChange={(e) => { setDate((x) => ({ ...x, m: e.target.value.replace(/\D/g, "") })); setSaved(false); }}
            />
            <span>/</span>
            <input
              className="field" inputMode="numeric" maxLength={4} placeholder="aaaa" style={{ width: 72 }}
              value={date.y} onChange={(e) => { setDate((x) => ({ ...x, y: e.target.value.replace(/\D/g, "") })); setSaved(false); }}
            />
          </div>
        </div>
        {dateInvalid && <div className="errline">{"Indique un d\u00eda, mes y a\u00f1o v\u00e1lidos, o deje los campos vac\u00edos."}</div>}
        <div className="setrow">
          <div>
            <div className="lbl">Tolerancia de importe (EUR)</div>
          </div>
          <input
            className="field" type="number" step="0.01" min="0" style={{ width: 120 }}
            value={draft.tolerance} onChange={(e) => patch({ tolerance: e.target.value })}
          />
        </div>
      </div>

      <div className="section-title">{"Pol\u00edtica"}</div>
      <div className="card">
        {codes.map((code) => {
          const meta = draft.reasons[code];
          const current = draft.reason_outcomes[code];
          return (
            <div key={code} className="policy-row">
              <div className="policy-meta">
                <span className="rule-tag">regla {meta?.rule ?? "-"}</span>
                <span className="name">{meta?.label ?? code}</span>
                <span className="help">{meta?.help ?? code}</span>
              </div>
              <div className="seg">
                {RESULTS.map((r) => (
                  <button
                    key={r}
                    className={current === r ? `on ${r}` : ""}
                    onClick={() => setOutcome(code, r)}
                  >
                    {r === "NO_PAGAR" ? "NO PAGAR" : r}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="savebar">
        {saved && !dirty && <span className="toast">Guardado</span>}
        <button
          className="btn ghost sm"
          disabled={!dirty || saving}
          onClick={() => { setDraft(policy); setDate(fromIso(policy?.today ?? null)); }}
        >
          Restablecer
        </button>
        <button className="btn" disabled={!dirty || saving || dateInvalid} onClick={save}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </>
  );
}
