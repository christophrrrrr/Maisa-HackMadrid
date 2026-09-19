import type { Decision, Policy, Result } from "./types";

const LEAK = new Set(["already_paid", "duplicate_pedido"]);
const SKIP_REASON = new Set(["all_rules_pass", ""]);

export type Tone = Result | "MIX";

export type CountRow = {
  code: string;
  label: string;
  n: number;
  tone: Tone;
};

export type SupplierRow = {
  key: string;
  name: string;
  nif: string;
  escalar: number;
  euros: number;
  topFinding: string;
};

export type InsightsData = {
  total: number;
  auto: number;
  stpPct: number;
  euros: { PAGAR: number; NO_PAGAR: number; ESCALAR: number };
  counts: { PAGAR: number; NO_PAGAR: number; ESCALAR: number };
  reasons: CountRow[];
  findings: CountRow[];
  leakN: number;
  leakEuros: number;
  extractN: number;
  extractPct: number;
  suppliers: SupplierRow[];
};

function field(d: Decision, key: string): unknown {
  return (d.extracted ?? {})[key];
}

function moneyOf(d: Decision): number {
  const n = Number(field(d, "total"));
  return Number.isFinite(n) ? n : 0;
}

function labelOf(code: string, policy: Policy | null): string {
  return policy?.reasons?.[code]?.label ?? code;
}

function toneOf(code: string, hits: Decision[], policy: Policy | null): Tone {
  const fromPolicy = policy?.reason_outcomes?.[code];
  if (fromPolicy) return fromPolicy;
  const results = new Set(hits.map((d) => d.result));
  if (results.size === 1) return [...results][0];
  return "MIX";
}

function rank(
  counts: Map<string, { n: number; hits: Decision[] }>,
  policy: Policy | null,
): CountRow[] {
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([code, { n, hits }]) => ({
      code,
      label: labelOf(code, policy),
      n,
      tone: toneOf(code, hits, policy),
    }));
}

function bump(
  map: Map<string, { n: number; hits: Decision[] }>,
  code: string,
  d: Decision,
) {
  const cur = map.get(code) ?? { n: 0, hits: [] };
  cur.n += 1;
  cur.hits.push(d);
  map.set(code, cur);
}

function supplierKey(d: Decision): { key: string; nif: string; name: string } {
  const nif = String(field(d, "supplier_tax_id") ?? "").trim();
  const id = String((d.evidence ?? {}).supplier_id ?? "").trim();
  const name = String(field(d, "supplier_name") ?? "").trim();
  if (nif) return { key: nif, nif, name: name || nif };
  if (id) return { key: id, nif: id, name: name || id };
  return { key: "sin-nif", nif: "sin NIF", name: name || "Sin proveedor" };
}

function topCode(codes: string[]): string {
  const n = new Map<string, number>();
  for (const c of codes) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

export function buildInsights(decisions: Decision[], policy: Policy | null): InsightsData {
  const counts = { PAGAR: 0, NO_PAGAR: 0, ESCALAR: 0 };
  const euros = { PAGAR: 0, NO_PAGAR: 0, ESCALAR: 0 };
  const reasons = new Map<string, { n: number; hits: Decision[] }>();
  const findings = new Map<string, { n: number; hits: Decision[] }>();
  const bySupplier = new Map<string, { row: SupplierRow; findings: string[] }>();

  let leakN = 0;
  let leakEuros = 0;
  let extractN = 0;

  for (const d of decisions) {
    counts[d.result] += 1;
    euros[d.result] += moneyOf(d);

    if (!SKIP_REASON.has(d.reason)) bump(reasons, d.reason, d);
    for (const f of d.findings || []) {
      if (f) bump(findings, f, d);
    }

    const leak = LEAK.has(d.reason) || (d.findings || []).some((f) => LEAK.has(f));
    if (leak) {
      leakN += 1;
      leakEuros += moneyOf(d);
    }

    const extractFail =
      d.reason === "incomplete_extraction" || (d.findings || []).includes("incomplete_extraction");
    if (d.result === "ESCALAR" && extractFail) extractN += 1;

    if (d.result === "ESCALAR") {
      const { key, nif, name } = supplierKey(d);
      const cur = bySupplier.get(key) ?? {
        row: { key, name, nif, escalar: 0, euros: 0, topFinding: "" },
        findings: [],
      };
      cur.row.escalar += 1;
      cur.row.euros += moneyOf(d);
      const fired = (d.findings || []).filter(Boolean);
      cur.findings.push(...(fired.length ? fired : d.reason ? [d.reason] : []));
      bySupplier.set(key, cur);
    }
  }

  const suppliers = [...bySupplier.values()]
    .map(({ row, findings: fs }) => ({
      ...row,
      topFinding: labelOf(topCode(fs), policy) || "-",
    }))
    .sort((a, b) => b.euros - a.euros || b.escalar - a.escalar || a.name.localeCompare(b.name))
    .slice(0, 8);

  const total = decisions.length;
  const auto = counts.PAGAR + counts.NO_PAGAR;
  return {
    total,
    auto,
    stpPct: total ? Math.round((auto / total) * 100) : 0,
    euros,
    counts,
    reasons: rank(reasons, policy),
    findings: rank(findings, policy),
    leakN,
    leakEuros,
    extractN,
    extractPct: counts.ESCALAR ? Math.round((extractN / counts.ESCALAR) * 100) : 0,
    suppliers,
  };
}

export function euros(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export function pctBar(n: number, max: number): string {
  return max ? `${Math.round((n / max) * 100)}%` : "0%";
}
