"use client";

import { useEffect, useMemo, useState } from "react";
import type { Policy, Result } from "@/lib/types";

const RESULTS: Result[] = ["PAGAR", "NO_PAGAR", "ESCALAR"];

interface RuleForm {
  code: string;
  label: string;
  rule: string;
  help: string;
  outcome: Result;
}

const EMPTY_RULE: RuleForm = {
  code: "",
  label: "",
  rule: "",
  help: "",
  outcome: "ESCALAR",
};

export default function RulesPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [form, setForm] = useState<RuleForm | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/policy").then((r) => r.json()).then((next: Policy) => {
      setPolicy(next);
      setDraft(next);
    });
  }, []);

  const dirty = useMemo(() => {
    if (!policy || !draft) return false;
    return JSON.stringify(policy.reasons) !== JSON.stringify(draft.reasons)
      || JSON.stringify(policy.reason_outcomes) !== JSON.stringify(draft.reason_outcomes);
  }, [policy, draft]);

  function openNew() {
    setEditingCode(null);
    setForm({ ...EMPTY_RULE });
    setFormError("");
  }

  function openEdit(code: string) {
    if (!draft) return;
    const definition = draft.reasons[code];
    setEditingCode(code);
    setForm({
      code,
      label: definition.label,
      rule: definition.rule,
      help: definition.help,
      outcome: draft.reason_outcomes[code] ?? "ESCALAR",
    });
    setFormError("");
  }

  function applyForm() {
    if (!draft || !form) return;
    const code = form.code.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(code)) {
      setFormError("El c\u00f3digo solo puede contener letras min\u00fasculas, n\u00fameros y guiones bajos.");
      return;
    }
    if (!editingCode && draft.reasons[code]) {
      setFormError("Ya existe una regla con este c\u00f3digo.");
      return;
    }
    if (!form.label.trim() || !form.rule.trim() || !form.help.trim()) {
      setFormError("Completa el nombre, el grupo y la descripci\u00f3n.");
      return;
    }
    setDraft({
      ...draft,
      reasons: {
        ...draft.reasons,
        [code]: {
          label: form.label.trim(),
          rule: form.rule.trim(),
          help: form.help.trim(),
        },
      },
      reason_outcomes: { ...draft.reason_outcomes, [code]: form.outcome },
    });
    setSaved(false);
    setForm(null);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const updated: Policy = await fetch("/api/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reasons: draft.reasons,
        reason_outcomes: draft.reason_outcomes,
      }),
    }).then((r) => r.json());
    setPolicy(updated);
    setDraft(updated);
    setSaving(false);
    setSaved(true);
  }

  if (!draft) return <div className="muted">Cargando reglas...</div>;

  const codes = Object.keys(draft.reasons);

  return (
    <div className="settings-page rules-page">
      <header className="settings-heading">
        <div>
          <div className="settings-eyebrow">Pol&iacute;tica de decisi&oacute;n</div>
          <h1>Reglas</h1>
          <p>Gestiona las respuestas que aplica el motor ante cada comprobaci&oacute;n fallida.</p>
        </div>
        <div className="rules-heading-actions">
          <div className={"settings-status" + (dirty ? " dirty" : "")}>
            <span />
            {dirty ? "Cambios sin guardar" : "Todo actualizado"}
          </div>
          <button type="button" className="btn" onClick={openNew}>A&ntilde;adir regla</button>
        </div>
      </header>

      <section className="settings-card">
        <div className="settings-card-head">
          <div className="settings-card-icon" aria-hidden="true">{String(codes.length).padStart(2, "0")}</div>
          <div>
            <h2>Reglas configuradas</h2>
            <p>Edita su descripci&oacute;n, agrupaci&oacute;n y resultado.</p>
          </div>
        </div>
        <div className="rules-list">
          {codes.map((code) => {
            const definition = draft.reasons[code];
            const outcome = draft.reason_outcomes[code] ?? "ESCALAR";
            return (
              <article className="rule-row" key={code}>
                <div className="rule-row-copy">
                  <div className="rule-row-title">
                    <span className="rule-tag">regla {definition.rule}</span>
                    <strong>{definition.label}</strong>
                  </div>
                  <p>{definition.help}</p>
                  <code>{code}</code>
                </div>
                <div className="rule-row-actions">
                  <span className={`result-pill ${outcome}`}>{outcome === "NO_PAGAR" ? "NO PAGAR" : outcome}</span>
                  <button type="button" className="btn ghost sm" onClick={() => openEdit(code)}>Editar</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="savebar settings-savebar">
        <div className="savebar-copy">
          <strong>{dirty ? "Hay cambios pendientes" : "Reglas al d\u00eda"}</strong>
          <span>{dirty ? "Guarda para aplicar la nueva pol\u00edtica." : "No hay cambios pendientes de guardar."}</span>
        </div>
        {saved && !dirty && <span className="toast">Guardado</span>}
        <button
          type="button"
          className="btn ghost"
          disabled={!dirty || saving}
          onClick={() => { setDraft(policy); setSaved(false); }}
        >
          Restablecer
        </button>
        <button type="button" className="btn" disabled={!dirty || saving} onClick={save}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>

      {form && (
        <div className="modal-back" role="presentation" onClick={() => setForm(null)}>
          <div className="modal rule-editor" role="dialog" aria-modal="true" aria-labelledby="rule-editor-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="settings-eyebrow">{editingCode ? "Editar regla" : "Nueva regla"}</div>
                <div className="modal-file" id="rule-editor-title">{editingCode ? form.label : "A\u00f1adir regla"}</div>
              </div>
            </div>
            <div className="rule-form">
              <label>
                <span>C&oacute;digo</span>
                <input
                  className="field"
                  value={form.code}
                  disabled={Boolean(editingCode)}
                  placeholder="mi_regla"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </label>
              <label>
                <span>Nombre</span>
                <input className="field" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </label>
              <label>
                <span>Grupo</span>
                <input className="field" value={form.rule} placeholder="1" onChange={(e) => setForm({ ...form, rule: e.target.value })} />
              </label>
              <label>
                <span>Descripci&oacute;n</span>
                <textarea value={form.help} onChange={(e) => setForm({ ...form, help: e.target.value })} />
              </label>
              <div>
                <span className="rule-form-label">Resultado al fallar</span>
                <div className="seg rule-outcomes">
                  {RESULTS.map((result) => (
                    <button
                      type="button"
                      key={result}
                      className={form.outcome === result ? `on ${result}` : ""}
                      onClick={() => setForm({ ...form, outcome: result })}
                    >
                      {result === "NO_PAGAR" ? "NO PAGAR" : result}
                    </button>
                  ))}
                </div>
              </div>
              {formError && <div className="errline">{formError}</div>}
            </div>
            <div className="rule-form-actions">
              <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancelar</button>
              <button type="button" className="btn" onClick={applyForm}>{editingCode ? "Aplicar cambios" : "A\u00f1adir regla"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
