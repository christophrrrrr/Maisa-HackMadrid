import type { Decision } from "./types";

export const INCIDENT_STATUS_EVENT = "invoice-incident-status";

export function incidentKey(decision: Decision): string {
  return `${decision.run_id || "norun"}:${decision.file_id}`;
}

function storageKey(decision: Decision): string {
  return `incident-sent:${incidentKey(decision)}`;
}

export function isIncidentSent(decision: Decision): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(storageKey(decision)) === "true";
}

export function setIncidentSent(decision: Decision, sent: boolean): void {
  if (typeof window === "undefined") return;
  if (sent) window.localStorage.setItem(storageKey(decision), "true");
  else window.localStorage.removeItem(storageKey(decision));
  window.dispatchEvent(new CustomEvent(INCIDENT_STATUS_EVENT, {
    detail: { key: incidentKey(decision), sent },
  }));
}
