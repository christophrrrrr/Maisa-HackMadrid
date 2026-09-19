import type { Decision } from "./types";

export const INCIDENT_STATUS_EVENT = "invoice-incident-status";
export type IncidentStatus = "pending" | "sent" | "resolved";

export function incidentKey(decision: Decision): string {
  return `${decision.run_id || "norun"}:${decision.file_id}`;
}

function storageKey(decision: Decision): string {
  return `incident-status:${incidentKey(decision)}`;
}

function legacyStorageKey(decision: Decision): string {
  return `incident-sent:${incidentKey(decision)}`;
}

export function getIncidentStatus(decision: Decision): IncidentStatus {
  if (typeof window === "undefined") return "pending";
  const stored = window.localStorage.getItem(storageKey(decision));
  if (stored === "sent" || stored === "resolved") return stored;
  return window.localStorage.getItem(legacyStorageKey(decision)) === "true" ? "sent" : "pending";
}

export function setIncidentStatus(decision: Decision, status: IncidentStatus): void {
  if (typeof window === "undefined") return;
  if (status === "pending") window.localStorage.removeItem(storageKey(decision));
  else window.localStorage.setItem(storageKey(decision), status);
  window.localStorage.removeItem(legacyStorageKey(decision));
  window.dispatchEvent(new CustomEvent(INCIDENT_STATUS_EVENT, {
    detail: { key: incidentKey(decision), status },
  }));
}
