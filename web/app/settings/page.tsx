"use client";

import { useEffect, useMemo, useState } from "react";
import type { FileKind, FileTypeConfig, Policy, Result } from "@/lib/types";
import {
  clearWatchHandle, pickDirectory, saveWatchHandle, withFileDefaults,
} from "@/lib/files";

const RESULTS: Result[] = ["PAGAR", "NO_PAGAR", "ESCALAR"];
// must stay in sync with src/policy.py FILE_TYPE_META / DEFAULT_FILE_TYPES
const KIND_ORDER: FileKind[] = ["pdf", "image", "xml", "email", "docx", "spreadsheet", "text"];
const KIND_GROUPS: { title: string; help: string; kinds: FileKind[] }[] = [
  {
    title: "Facturas",
    help: "Formatos habituales de factura de proveedor.",
    kinds: ["pdf", "image", "xml"],
  },
  {
    title: "Otros documentos",
    help: "Ingesta universal: se extraen campos o se escala si no es una factura.",
    kinds: ["email", "docx", "spreadsheet", "text"],
  },
];

const KIND_READER: Record<FileKind, string> = {
  pdf: "Texto embebido; visi\u00f3n si es un escaneo",
  image: "Visi\u00f3n / OCR",
  xml: "FacturaE / UBL estructurado",
  email: "Cuerpo y adjuntos; IA si falta texto",
  docx: "Texto del documento; IA si no basta",
  spreadsheet: "Tablas Excel / CSV",
  text: "Texto / HTML; IA si no basta",
};

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

function Switch({ on, onClick, label, disabled }: {
  on: boolean; onClick: () => void; label: string; disabled?: boolean;
}) {
  return (
    <span className={"switch-wrap" + (disabled ? " disabled" : "")} title={disabled ? "Debe quedar al menos un formato activo" : undefined}>
      <button
        type="button"
        className={"switch" + (on ? " on" : "")}
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
        disabled={disabled}
      >
        <i />
      </button>
      <span className={"switch-state" + (on ? " on" : "")} aria-hidden="true">
        {on ? "Activo" : "Inactivo"}
      </span>
    </span>
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
  function patchGroup(kinds: FileKind[], enabled: boolean) {
    setDraft((d) => {
      if (!d) return d;
      const file_types = { ...d.file_types };
      for (const k of kinds) {
        if (!file_types[k]) continue;
        file_types[k] = { ...file_types[k], enabled };
      }
      if (!Object.values(file_types).some((spec) => spec.enabled) && file_types.pdf) {
        file_types.pdf = { ...file_types.pdf, enabled: true };
      }
      return { ...d, file_types };
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
  const metaKeys = Object.keys(draft.file_type_meta) as FileKind[];
  const kinds: FileKind[] = [
    ...KIND_ORDER.filter((k) => metaKeys.includes(k) || Boolean(draft.file_types[k])),
    ...metaKeys.filter((k) => !KIND_ORDER.includes(k)),
  ];
  const groups = KIND_GROUPS
    .map((g) => ({ ...g, kinds: g.kinds.filter((k) => kinds.includes(k)) }))
    .filter((g) => g.kinds.length > 0);
  const grouped = new Set(groups.flatMap((g) => g.kinds));
  const leftover = kinds.filter((k) => !grouped.has(k));
  if (leftover.length) groups.push({ title: "Otros", help: "", kinds: leftover });
  const enabledCount = kinds.filter((k) => draft.file_types[k]?.enabled).length;
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
                <p>{"Elige los formatos que el lote acepta y c\u00f3mo se leen."}</p>
              </div>
              <span className="file-type-count">{enabledCount} de {kinds.length} activos</span>
            </div>
            {groups.map((group) => {
              const onInGroup = group.kinds.filter((k) => draft.file_types[k]?.enabled).length;
              const allOn = onInGroup === group.kinds.length;
              return (
                <div key={group.title} className="file-type-group">
                  <div className="file-type-group-head">
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.help}</span>
                    </div>
                    {group.kinds.length > 1 && (
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => patchGroup(group.kinds, !allOn)}
                      >
                        {allOn ? "Desactivar grupo" : "Activar grupo"}
                      </button>
                    )}
                  </div>
                  <div className="file-type-list">
                    {group.kinds.map((kind) => {
                      const spec = draft.file_types[kind] ?? { enabled: false };
                      const meta = draft.file_type_meta[kind];
                      const label = meta?.label ?? kind;
                      const lastOn = spec.enabled && enabledCount <= 1;
                      return (
                        <div key={kind} className={"file-type-item" + (spec.enabled ? " on" : " off")}>
                          <div className="file-type-head">
                            <div>
                              <div className="file-type-name">
                                <strong>{label}</strong>
                                <span className="file-type-reader">{KIND_READER[kind] ?? kind}</span>
                              </div>
                              <p>{meta?.help}</p>
                              <div className="ext-chips">
                                {(meta?.exts ?? []).map((ext) => (
                                  <span key={ext} className="ext-chip">{ext}</span>
                                ))}
                              </div>
                            </div>
                            <Switch
                              label={`${spec.enabled ? "Desactivar" : "Activar"} ${label}`}
                              on={Boolean(spec.enabled)}
                              disabled={lastOn}
                              onClick={() => {
                                if (lastOn) return;
                                patchType(kind, { enabled: !spec.enabled });
                              }}
                            />
                          </div>
                          {spec.enabled && (
                            <div className="file-type-options">
                              {kind === "pdf" && (
                                <div className="settings-field-row">
                                  <div className="settings-field-copy">
                                    <label>{"Visi\u00f3n en escaneos"}</label>
                                    <span>Usar OCR cuando el PDF no contiene texto.</span>
                                  </div>
                                  <Switch
                                    label={"Activar visi\u00f3n en PDF escaneados"}
                                    on={Boolean(spec.vision)}
                                    onClick={() => patchType(kind, { vision: !spec.vision })}
                                  />
                                </div>
                              )}
                              {kind === "image" && (
                                <>
                                  <div className="settings-field-row">
                                    <div className="settings-field-copy">
                                      <label>{"Visi\u00f3n / OCR"}</label>
                                      <span>Necesario para leer fotos y capturas.</span>
                                    </div>
                                    <Switch
                                      label={"Activar visi\u00f3n para im\u00e1genes"}
                                      on={Boolean(spec.vision)}
                                      onClick={() => patchType(kind, { vision: !spec.vision })}
                                    />
                                  </div>
                                  <div className="settings-field-row">
                                    <div className="settings-field-copy">
                                      <label htmlFor="image-max-size">{"Tama\u00f1o m\u00e1ximo"}</label>
                                      <span>{"L\u00edmite por imagen subida."}</span>
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
                                    <span>{"Interpretar etiquetas de facturas electr\u00f3nicas."}</span>
                                  </div>
                                  <Switch
                                    label="Activar lectura FacturaE y UBL"
                                    on={Boolean(spec.facturae)}
                                    onClick={() => patchType(kind, { facturae: !spec.facturae })}
                                  />
                                </div>
                              )}
                              {kind === "email" && (
                                <div className="settings-field-row">
                                  <div className="settings-field-copy">
                                    <label>IA en el cuerpo / adjuntos</label>
                                    <span>Si el correo no trae campos claros, extraer con IA.</span>
                                  </div>
                                  <Switch
                                    label={`${spec.vision ? "Desactivar" : "Activar"} IA para email`}
                                    on={Boolean(spec.vision)}
                                    onClick={() => patchType(kind, { vision: !spec.vision })}
                                  />
                                </div>
                              )}
                              {kind === "docx" && (
                                <div className="settings-field-row">
                                  <div className="settings-field-copy">
                                    <label>IA de respaldo</label>
                                    <span>Usar IA cuando el texto del Word no baste.</span>
                                  </div>
                                  <Switch
                                    label={`${spec.vision ? "Desactivar" : "Activar"} IA para Word`}
                                    on={Boolean(spec.vision)}
                                    onClick={() => patchType(kind, { vision: !spec.vision })}
                                  />
                                </div>
                              )}
                              {kind === "spreadsheet" && (
                                <div className="settings-field-row">
                                  <div className="settings-field-copy">
                                    <label>IA de respaldo</label>
                                    <span>Normalmente no hace falta: se leen las celdas.</span>
                                  </div>
                                  <Switch
                                    label={`${spec.vision ? "Desactivar" : "Activar"} IA para hojas`}
                                    on={Boolean(spec.vision)}
                                    onClick={() => patchType(kind, { vision: !spec.vision })}
                                  />
                                </div>
                              )}
                              {kind === "text" && (
                                <div className="settings-field-row">
                                  <div className="settings-field-copy">
                                    <label>IA de respaldo</label>
                                    <span>Usar IA cuando el texto o HTML no sea una factura clara.</span>
                                  </div>
                                  <Switch
                                    label={`${spec.vision ? "Desactivar" : "Activar"} IA para texto`}
                                    on={Boolean(spec.vision)}
                                    onClick={() => patchType(kind, { vision: !spec.vision })}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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
