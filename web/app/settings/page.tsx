"use client";

import { useEffect, useMemo, useState } from "react";
import type { FileKind, FileTypeConfig, Policy, Result } from "@/lib/types";
import {
  clearWatchHandle, pickDirectory, saveWatchHandle, withFileDefaults,
} from "@/lib/files";

const RESULTS: Result[] = ["PAGAR", "NO_PAGAR", "ESCALAR"];
const KINDS: FileKind[] = ["pdf", "image", "xml"];

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

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={"switch" + (on ? " on" : "")}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
    >
      <i />
    </button>
  );
}

export default function Settings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [date, setDate] = useState({ d: "", m: "", y: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [folderErr, setFolderErr] = useState("");
  const [canPick, setCanPick] = useState(false);

  useEffect(() => {
    setCanPick("showDirectoryPicker" in window);
    fetch("/api/policy").then((r) => r.json()).then((p: Policy) => {
      const full = withFileDefaults(p);
      setPolicy(full);
      setDraft(full);
      setDate(fromIso(full.today));
    });
  }, []);

  const dirty = useMemo(() => {
    if (!policy || !draft) return false;
    const today = toIso(date.d, date.m, date.y);
    return policy.tolerance !== draft.tolerance
      || (policy.today ?? null) !== (today ?? null)
      || JSON.stringify(policy.reason_outcomes) !== JSON.stringify(draft.reason_outcomes)
      || JSON.stringify(policy.file_types) !== JSON.stringify(draft.file_types)
      || JSON.stringify(policy.watch) !== JSON.stringify(draft.watch);
  }, [policy, draft, date]);

  function patch(p: Partial<Policy>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setSaved(false);
  }
  function setOutcome(code: string, outcome: Result) {
    setDraft((d) => (d ? { ...d, reason_outcomes: { ...d.reason_outcomes, [code]: outcome } } : d));
    setSaved(false);
  }
  function patchType(kind: FileKind, next: Partial<FileTypeConfig>) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        file_types: { ...d.file_types, [kind]: { ...d.file_types[kind], ...next } },
      };
    });
    setSaved(false);
  }

  async function chooseFolder() {
    setFolderErr("");
    const handle = await pickDirectory();
    if (!handle) {
      if (!canPick) setFolderErr("El selector de carpeta requiere Chrome o Edge.");
      return;
    }
    await saveWatchHandle(handle);
    patch({ watch: { enabled: true, folder_name: handle.name } });
  }

  async function setWatch(on: boolean) {
    setFolderErr("");
    if (!on) {
      patch({ watch: { enabled: false, folder_name: draft?.watch.folder_name ?? null } });
      return;
    }
    await chooseFolder();
  }

  async function save() {
    if (!draft) return;
    const today = toIso(date.d, date.m, date.y);
    if ((date.d || date.m || date.y) && !today) return;
    if (draft.watch.enabled && !draft.watch.folder_name) return;
    setSaving(true);
    const body = {
      tolerance: draft.tolerance,
      today,
      reason_outcomes: draft.reason_outcomes,
      file_types: draft.file_types,
      watch: draft.watch,
    };
    const updated: Policy = await fetch("/api/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()).then(withFileDefaults);
    if (!updated.watch.enabled) await clearWatchHandle();
    setPolicy(updated);
    setDraft(updated);
    setDate(fromIso(updated.today));
    setSaving(false);
    setSaved(true);
  }

  if (!draft) return <div className="muted">Cargando configuración...</div>;

  const codes = Object.keys(draft.reason_outcomes);
  const dateInvalid = Boolean((date.d || date.m || date.y) && !toIso(date.d, date.m, date.y));
  const watchInvalid = draft.watch.enabled && !draft.watch.folder_name;

  return (
    <div className="settings-page">
      <header className="settings-heading">
        <div>
          <div className="settings-eyebrow">Preferencias del sistema</div>
          <h1>Configuración</h1>
          <p>Define cómo se procesan, validan y clasifican las facturas.</p>
        </div>
        <div className={"settings-status" + (dirty ? " dirty" : "")}>
          <span />
          {dirty ? "Cambios sin guardar" : "Todo actualizado"}
        </div>
      </header>

      <div className="settings-layout">
        <div className="settings-stack">
          <section className="settings-card">
            <div className="settings-card-head">
              <div className="settings-card-icon" aria-hidden="true">01</div>
              <div>
                <h2>Ejecución</h2>
                <p>Valores utilizados en cada lote de facturas.</p>
              </div>
            </div>
            <div className="settings-card-body">
              <div className="settings-field-row">
                <div className="settings-field-copy">
                  <label>Fecha de referencia</label>
                  <span>Deja los campos vacíos para utilizar la fecha actual.</span>
                </div>
              <div className="date3">
                <input
                  aria-label="Día de referencia"
                  className="field" inputMode="numeric" maxLength={2} placeholder="dd" style={{ width: 52 }}
                  value={date.d} onChange={(e) => { setDate((x) => ({ ...x, d: e.target.value.replace(/\D/g, "") })); setSaved(false); }}
                />
                <span>/</span>
                <input
                  aria-label="Mes de referencia"
                  className="field" inputMode="numeric" maxLength={2} placeholder="mm" style={{ width: 52 }}
                  value={date.m} onChange={(e) => { setDate((x) => ({ ...x, m: e.target.value.replace(/\D/g, "") })); setSaved(false); }}
                />
                <span>/</span>
                <input
                  aria-label="Año de referencia"
                  className="field" inputMode="numeric" maxLength={4} placeholder="aaaa" style={{ width: 72 }}
                  value={date.y} onChange={(e) => { setDate((x) => ({ ...x, y: e.target.value.replace(/\D/g, "") })); setSaved(false); }}
                />
              </div>
            </div>
            {dateInvalid && <div className="errline">Indique un día, mes y año válidos, o deje los campos vacíos.</div>}
              <div className="settings-field-row">
                <div className="settings-field-copy">
                  <label htmlFor="tolerance">Tolerancia de importe</label>
                  <span>Margen permitido al comparar importes en EUR.</span>
                </div>
                <div className="input-suffix">
                  <input
                    id="tolerance"
                    className="field" type="number" step="0.01" min="0"
                    value={draft.tolerance} onChange={(e) => patch({ tolerance: e.target.value })}
                  />
                  <span>EUR</span>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div className="settings-card-icon" aria-hidden="true">02</div>
              <div>
                <h2>Tipos de archivo</h2>
                <p>Elige los formatos aceptados y su método de lectura.</p>
              </div>
            </div>
            <div className="file-type-list">
              {KINDS.map((kind) => {
                const spec = draft.file_types[kind];
                const meta = draft.file_type_meta[kind];
                const label = meta?.label ?? kind;
                return (
                  <div key={kind} className={"file-type-item" + (spec.enabled ? "" : " off")}>
                    <div className="file-type-head">
                      <div>
                        <div className="file-type-name">
                          <span className="file-type-badge">{kind}</span>
                          <strong>{label}</strong>
                        </div>
                        <p>{meta?.help} · {(meta?.exts ?? []).join(" ")}</p>
                      </div>
                      <Switch
                        label={`${spec.enabled ? "Desactivar" : "Activar"} ${label}`}
                        on={spec.enabled}
                        onClick={() => patchType(kind, { enabled: !spec.enabled })}
                      />
                    </div>
                    {spec.enabled && (
                      <div className="file-type-options">
                        {kind === "pdf" && (
                          <div className="settings-field-row">
                            <div className="settings-field-copy">
                              <label>Visión en escaneos</label>
                              <span>Usar OCR cuando el PDF no contiene texto.</span>
                            </div>
                            <Switch
                              label="Activar visión en PDF escaneados"
                              on={Boolean(spec.vision)}
                              onClick={() => patchType(kind, { vision: !spec.vision })}
                            />
                          </div>
                        )}
                        {kind === "image" && (
                          <>
                            <div className="settings-field-row">
                              <div className="settings-field-copy">
                                <label>Visión / OCR</label>
                                <span>Necesario para leer fotos y capturas.</span>
                              </div>
                              <Switch
                                label="Activar visión para imágenes"
                                on={Boolean(spec.vision)}
                                onClick={() => patchType(kind, { vision: !spec.vision })}
                              />
                            </div>
                            <div className="settings-field-row">
                              <div className="settings-field-copy">
                                <label htmlFor="image-max-size">Tamaño máximo</label>
                                <span>Límite por imagen subida.</span>
                              </div>
                              <div className="input-suffix narrow">
                                <input
                                  id="image-max-size"
                                  className="field" type="number" min={1} max={50} step={1}
                                  value={spec.max_mb ?? 12}
                                  onChange={(e) => patchType(kind, { max_mb: Number(e.target.value) || 1 })}
                                />
                                <span>MB</span>
                              </div>
                            </div>
                          </>
                        )}
                        {kind === "xml" && (
                          <div className="settings-field-row">
                            <div className="settings-field-copy">
                              <label>FacturaE / UBL</label>
                              <span>Interpretar etiquetas de facturas electrónicas.</span>
                            </div>
                            <Switch
                              label="Activar lectura FacturaE y UBL"
                              on={Boolean(spec.facturae)}
                              onClick={() => patchType(kind, { facturae: !spec.facturae })}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div className="settings-card-icon" aria-hidden="true">03</div>
              <div>
                <h2>Entrada automática</h2>
                <p>Procesa los archivos al detectarlos en una carpeta.</p>
              </div>
            </div>
            <div className="settings-card-body">
              <div className="settings-field-row">
                <div className="settings-field-copy">
                  <label>Vigilar una carpeta</label>
                  <span>
                    {draft.watch.enabled
                      ? "Los archivos nuevos se procesan automáticamente."
                      : "Los lotes se añaden y ejecutan manualmente."}
                  </span>
                </div>
                <Switch
                  label="Activar carpeta automática"
                  on={draft.watch.enabled}
                  onClick={() => setWatch(!draft.watch.enabled)}
                />
              </div>
              {draft.watch.enabled && (
                <div className="folder-picker">
                  <div className="folder-mark" aria-hidden="true" />
                  <div>
                    <strong>{draft.watch.folder_name || "Ninguna carpeta seleccionada"}</strong>
                    <span>{canPick ? "Carpeta vinculada a este navegador" : "Requiere Chrome o Edge"}</span>
                  </div>
                  <button type="button" className="btn ghost sm" onClick={chooseFolder}>
                    {draft.watch.folder_name ? "Cambiar" : "Seleccionar"}
                  </button>
                </div>
              )}
              {folderErr && <div className="errline">{folderErr}</div>}
              {watchInvalid && <div className="errline">Seleccione una carpeta para activar el modo automático.</div>}
            </div>
          </section>
        </div>

        <section className="settings-card policy-card">
          <div className="settings-card-head">
            <div className="settings-card-icon" aria-hidden="true">04</div>
            <div>
              <h2>Política de decisión</h2>
              <p>Asigna el resultado que corresponde a cada regla.</p>
            </div>
          </div>
          <div className="policy-list">
            {codes.map((code) => {
              const meta = draft.reasons[code];
              const current = draft.reason_outcomes[code];
              return (
                <div key={code} className="policy-item">
                  <div className="policy-item-top">
                    <span className="rule-tag">regla {meta?.rule ?? "-"}</span>
                    <strong>{meta?.label ?? code}</strong>
                  </div>
                  <p>{meta?.help ?? code}</p>
                  <div className="seg">
                    {RESULTS.map((r) => (
                      <button
                        type="button"
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
        </section>
      </div>

      <div className="savebar settings-savebar">
        <div className="savebar-copy">
          <strong>{dirty ? "Hay cambios pendientes" : "Configuración al día"}</strong>
          <span>{dirty ? "Guarda para aplicar los nuevos ajustes." : "No hay cambios pendientes de guardar."}</span>
        </div>
        {saved && !dirty && <span className="toast">Guardado</span>}
        <button
          className="btn ghost"
          disabled={!dirty || saving}
          onClick={() => { setDraft(policy); setDate(fromIso(policy?.today ?? null)); setFolderErr(""); }}
        >
          Restablecer
        </button>
        <button className="btn" disabled={!dirty || saving || dateInvalid || watchInvalid} onClick={save}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
