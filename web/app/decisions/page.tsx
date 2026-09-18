"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Decision, Result, StateSnapshot } from "@/lib/types";

const RESULTS: (Result | "ALL")[] = ["ALL", "PAGAR", "NO_PAGAR", "ESCALAR"];

export default function DecisionsPage() {
  const [snap, setSnap] = useState<StateSnapshot | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Result | "ALL">("ALL");

  useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then(setSnap);
  }, []);

  const rows = useMemo(() => {
    if (!snap) return [];
    const needle = q.trim().toLowerCase();
    return snap.decisions.filter((d: Decision) => {
      if (filter !== "ALL" && d.result !== filter) return false;
      if (!needle) return true;
      return (
        d.file_id.toLowerCase().includes(needle) ||
        d.reason.toLowerCase().includes(needle) ||
        JSON.stringify(d.evidence).toLowerCase().includes(needle)
      );
    });
  }, [snap, q, filter]);

  return (
    <>
      <h1 style={{ margin: "0 0 14px" }}>Decisions</h1>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input
          className="search"
          placeholder="Search file, reason, pedido…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ display: "flex", gap: 6 }}>
          {RESULTS.map((r) => (
            <button
              key={r}
              className={`btn ghost ${filter === r ? "" : ""}`}
              style={filter === r ? { borderColor: "var(--accent)", color: "#fff" } : {}}
              onClick={() => setFilter(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
          {rows.length}{snap ? ` / ${snap.decisions.length}` : ""}
        </span>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>File</th><th>Result</th><th>Reason</th><th>Pedido</th><th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {!snap && <tr><td colSpan={5} className="muted" style={{ padding: 18 }}>Loading…</td></tr>}
            {rows.map((d) => (
              <tr key={d.file_id}>
                <td className="mono">
                  <Link href={`/decisions/${encodeURIComponent(d.file_id)}`}>{d.file_id}</Link>
                </td>
                <td><span className={`pill ${d.result}`}>{d.result}</span></td>
                <td className="mono muted">{d.reason}</td>
                <td className="mono muted">{String((d.evidence as any)?.pedido ?? "—")}</td>
                <td className="mono muted">{d.latency_ms != null ? `${d.latency_ms.toFixed(0)}ms` : "—"}</td>
              </tr>
            ))}
            {snap && rows.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ padding: 18 }}>No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
