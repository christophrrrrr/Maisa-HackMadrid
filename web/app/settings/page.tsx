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

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={"switch" + (on ? " on" : "")} onClick={onClick} aria-pressed={on}>
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

  if (!draft) return <div className="muted">{"Cargando configuraci\u00f3n..."}</div>;

  const codes = Object.keys(draft.reason_outcomes);
  const dateInvalid = Boolean((date.d || date.m || date.y) && !toIso(date.d, date.m, date.y));
  const watchInvalid = draft.watch.enabled && !draft.watch.folder_name;

  return (
    <>
      <h1 style={{ marginBottom: 20 }}>{"Configuraci\u00f3n"}</h1>

      <div className="settings-grid">
        <div className="settings-col">
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

          <div className="section-title">Tipos de archivo</div>
          <div className="card">
            {KINDS.map((kind) => {
              const spec = draft.file_types[kind];
              const meta = draft.file_type_meta[kind];
              return (
                <div key={kind} className={"ftype" + (spec.enabled ? "" : " off")}>
                  <div className="ftype-head">
                    <div>
                      <div className="lbl">{meta?.label ?? kind}</div>
                      <div className="desc">{meta?.help} - {(meta?.exts ?? []).join(" ")}</div>
                    </div>
                    <Switch on={spec.enabled} onClick={() => patchType(kind, { enabled: !spec.enabled })} />
                  </div>
                  {spec.enabled && kind === "pdf" && (
                    <div className="setrow">
                      <div>
                        <div className="lbl">Visi{"\u00f3"}n en escaneos</div>
                        <div className="desc">OCR si el PDF no tiene texto</div>
                      </div>
                      <Switch on={Boolean(spec.vision)} onClick={() => patchType(kind, { vision: !spec.vision })} />
                    </div>
                  )}
                  {spec.enabled && kind === "image" && (
                    <>
                      <div className="setrow">
                        <div>
                          <div className="lbl">Visi{"\u00f3"}n / OCR</div>
                          <div className="desc">necesario para leer fotos</div>
                        </div>
                        <Switch on={Boolean(spec.vision)} onClick={() => patchType(kind, { vision: !spec.vision })} />
                      </div>
                      <div className="setrow">
                        <div>
                          <div className="lbl">Tama{"\u00f1"}o m{"\u00e1"}ximo (MB)</div>
                        </div>
                        <input
                          className="field" type="number" min={1} max={50} step={1} style={{ width: 88 }}
                          value={spec.max_mb ?? 12}
                          onChange={(e) => patchType(kind, { max_mb: Number(e.target.value) || 1 })}
                        />
                      </div>
                    </>
                  )}
                  {spec.enabled && kind === "xml" && (
                    <div className="setrow">
                      <div>
                        <div className="lbl">FacturaE / UBL</div>
                        <div className="desc">parsear etiquetas electr{"\u00f3"}nicas</div>
                      </div>
                      <Switch on={Boolean(spec.facturae)} onClick={() => patchType(kind, { facturae: !spec.facturae })} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="section-title">Entrada</div>
          <div className="card compact">
            <div className="setrow">
              <div>
                <div className="lbl">Carpeta autom{"\u00e1"}tica</div>
                <div className="desc">
                  {draft.watch.enabled
                    ? "los archivos nuevos se procesan solos"
                    : "a\u00f1adir y ejecutar el lote a mano"}
                </div>
              </div>
              <Switch on={draft.watch.enabled} onClick={() => setWatch(!draft.watch.enabled)} />
            </div>
            {draft.watch.enabled && (
              <div className="setrow">
                <div>
                  <div className="lbl">{draft.watch.folder_name || "Ninguna carpeta"}</div>
                  <div className="desc">
                    {canPick ? "se vigila en este navegador" : "requiere Chrome o Edge"}
                  </div>
                </div>
                <button type="button" className="btn ghost sm" onClick={chooseFolder}>
                  {draft.watch.folder_name ? "Cambiar" : "Seleccionar"}
                </button>
              </div>
            )}
            {folderErr && <div className="errline">{folderErr}</div>}
            {watchInvalid && <div className="errline">Seleccione una carpeta para activar el modo autom{"\u00e1"}tico.</div>}
          </div>
        </div>

        <div className="settings-col">
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
        </div>
      </div>

      <div className="savebar">
        {saved && !dirty && <span className="toast">Guardado</span>}
        <button
          className="btn ghost sm"
          disabled={!dirty || saving}
          onClick={() => { setDraft(policy); setDate(fromIso(policy?.today ?? null)); setFolderErr(""); }}
        >
          Restablecer
        </button>
        <button className="btn" disabled={!dirty || saving || dateInvalid || watchInvalid} onClick={save}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </>
  );
}
