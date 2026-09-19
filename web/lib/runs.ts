import type { RunRow } from "./types";

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function batchLabel(run: RunRow) {
  if (!/^lote(?:1|2|-[0-9a-f-]+)$/i.test(run.batch)) return run.batch;
  return `Lote ${new Date(run.started_at).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })}`;
}

export function runErrors(run: RunRow | null): string[] {
  if (!run) return [];
  const stats = typeof run.stats === "object" && run.stats ? run.stats : {};
  const raw = (stats as Record<string, unknown>).errors;
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => String(e)).filter(Boolean);
}

export function runWarnings(run: RunRow | null): string[] {
  if (!run) return [];
  const stats = typeof run.stats === "object" && run.stats ? run.stats : {};
  const raw = (stats as Record<string, unknown>).data_warnings;
  if (!Array.isArray(raw)) return [];
  return raw.map((warning) => String(warning)).filter(Boolean);
}

export function statusLabel(status: string) {
  if (status === "done") return "Completada";
  if (status === "running") return "En curso";
  if (status === "error") return "Error";
  if (status === "scheduled") return "Programada";
  return status;
}

export function statusTone(status: string) {
  if (status === "error") return "ESCALAR";
  if (status === "done") return "PAGAR";
  return "NO_PAGAR";
}
