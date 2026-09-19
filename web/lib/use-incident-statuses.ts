"use client";

import { useEffect, useMemo, useState } from "react";
import type { Decision } from "./types";
import {
  getIncidentStatus,
  INCIDENT_STATUS_EVENT,
  incidentKey,
  type IncidentStatus,
} from "./incident-status";

export function useIncidentStatuses(decisions: Decision[]) {
  const [statuses, setStatuses] = useState<Map<string, IncidentStatus>>(new Map());

  useEffect(() => {
    setStatuses(new Map(decisions.map((decision) => [
      incidentKey(decision),
      getIncidentStatus(decision),
    ])));
  }, [decisions]);

  useEffect(() => {
    const update = (event: Event) => {
      const { key, status } = (
        event as CustomEvent<{ key: string; status: IncidentStatus }>
      ).detail;
      setStatuses((current) => new Map(current).set(key, status));
    };
    window.addEventListener(INCIDENT_STATUS_EVENT, update);
    return () => window.removeEventListener(INCIDENT_STATUS_EVENT, update);
  }, []);

  const unresolvedCount = useMemo(
    () => decisions.filter((decision) => statuses.get(incidentKey(decision)) !== "resolved").length,
    [decisions, statuses],
  );

  return {
    statusFor: (decision: Decision): IncidentStatus => (
      statuses.get(incidentKey(decision)) ?? "pending"
    ),
    unresolvedCount,
  };
}
