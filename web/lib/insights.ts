import type { Decision, Policy, Result, RunRow } from "./types";
import { reasonLabel } from "./reasons";

const LEAK = new Set(["already_paid", "duplicate_pedido"]);

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
  totalInvoices: number;
  lowConfidence: number;
  findingCount: number;
  invoices: Array<{
    fileId: string;
    invoiceNumber: string;
    purchaseOrder: string;
    issueDate: string;
    total: number;
    reason: string;
    extractionOk: boolean;
  }>;
  findings: Array<{
    code: string;
    label: string;
    n: number;
    pct: number;
  }>;
};

export type InsightsData = {
  total: number;
  auto: number;
  stpPct: number;
  euros: { PAGAR: number; NO_PAGAR: number; ESCALAR: number };
  counts: { PAGAR: number; NO_PAGAR: number; ESCALAR: number };
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
  return reasonLabel(code, policy);
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
  if (name) return { key: `name:${name.toLocaleLowerCase("es")}`, nif: "sin NIF", name };
  return { key: "sin-nif", nif: "sin NIF", name: name || "Sin proveedor" };
}

export function buildInsights(decisions: Decision[], policy: Policy | null): InsightsData {
  const counts = { PAGAR: 0, NO_PAGAR: 0, ESCALAR: 0 };
  const euros = { PAGAR: 0, NO_PAGAR: 0, ESCALAR: 0 };
  const findings = new Map<string, { n: number; hits: Decision[] }>();
  const bySupplier = new Map<string, { row: SupplierRow; findings: string[] }>();

  let leakN = 0;
  let leakEuros = 0;
  let extractN = 0;

  for (const d of decisions) {
    counts[d.result] += 1;
    euros[d.result] += moneyOf(d);

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

    const { key, nif, name } = supplierKey(d);
    const cur = bySupplier.get(key) ?? {
      row: {
        key,
        name,
        nif,
        escalar: 0,
        euros: 0,
        totalInvoices: 0,
        lowConfidence: 0,
        findingCount: 0,
        invoices: [],
        findings: [],
      },
      findings: [],
    };
    cur.row.totalInvoices += 1;
    if (!d.extraction_ok) cur.row.lowConfidence += 1;

    if (d.result === "ESCALAR") {
      cur.row.escalar += 1;
      cur.row.euros += moneyOf(d);
      cur.row.invoices.push({
        fileId: d.file_id,
        invoiceNumber: String(field(d, "invoice_number") ?? "").trim(),
        purchaseOrder: String(field(d, "purchase_order") ?? "").trim(),
        issueDate: String(field(d, "issue_date") ?? "").trim(),
        total: moneyOf(d),
        reason: labelOf(d.reason, policy),
        extractionOk: d.extraction_ok,
      });
    }

    const fired = (d.findings || []).filter(Boolean);
    cur.findings.push(...(fired.length ? fired : d.result === "ESCALAR" && d.reason ? [d.reason] : []));
    bySupplier.set(key, cur);
  }

  const suppliers = [...bySupplier.values()]
    .map(({ row, findings: fs }) => {
      const findingCounts = new Map<string, number>();
      fs.forEach((code) => findingCounts.set(code, (findingCounts.get(code) ?? 0) + 1));
      const rankedFindings = [...findingCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, n]) => ({
          code,
          label: labelOf(code, policy),
          n,
          pct: fs.length ? Math.round((n / fs.length) * 100) : 0,
        }));
      return {
        ...row,
        invoices: row.invoices.sort((a, b) =>
          b.issueDate.localeCompare(a.issueDate) || a.fileId.localeCompare(b.fileId)
        ),
        findingCount: fs.length,
        findings: rankedFindings,
      };
    })
    .sort((a, b) => b.euros - a.euros || b.escalar - a.escalar || a.name.localeCompare(b.name));

  const total = decisions.length;
  const auto = counts.PAGAR + counts.NO_PAGAR;
  return {
    total,
    auto,
    stpPct: total ? Math.round((auto / total) * 100) : 0,
    euros,
    counts,
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

export function usd(n: number): string {
  const digits = n > 0 && n < 0.01 ? 4 : 2;
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

export type RunOps = {
  costUsd: number;
  nVision: number;
  nPaid: number;
  nFiles: number;
  filesPerS: number | null;
  elapsedS: number | null;
  avgLatencyMs: number | null;
};

function asStats(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export function runOps(run: RunRow | null, decisions: Decision[]): RunOps | null {
  if (!run) return null;
  const ofRun = decisions.filter((d) => d.run_id === run.run_id);
  const stats = asStats(run.stats);
  const fromDecisions = ofRun.reduce((s, d) => s + (Number(d.cost_usd) || 0), 0);
  const fromRun = Number(run.cost_usd) || 0;
  const fromStats = Number(stats.cost_usd) || 0;
  const costUsd = fromRun || fromStats || fromDecisions;
  const nVision = Number(stats.n_vision) || ofRun.filter((d) => d.extraction_method === "vision").length;
  const latencies = ofRun.map((d) => Number(d.latency_ms)).filter((n) => Number.isFinite(n) && n > 0);
  const avgFromStats = Number(stats.avg_latency_ms);
  const avgFromFiles = latencies.length
    ? latencies.reduce((s, n) => s + n, 0) / latencies.length
    : null;
  const avgLatencyMs = Number.isFinite(avgFromStats) && avgFromStats > 0
    ? avgFromStats
    : avgFromFiles;
  const filesPerS = run.files_per_s != null ? Number(run.files_per_s) : null;
  const elapsedS = run.elapsed_s != null ? Number(run.elapsed_s) : null;
  return {
    costUsd,
    nVision,
    nPaid: ofRun.filter((d) => (Number(d.cost_usd) || 0) > 0).length,
    nFiles: Number(run.total) || ofRun.length,
    filesPerS: filesPerS != null && Number.isFinite(filesPerS) ? filesPerS : null,
    elapsedS: elapsedS != null && Number.isFinite(elapsedS) ? elapsedS : null,
    avgLatencyMs: avgLatencyMs != null && Number.isFinite(avgLatencyMs) ? avgLatencyMs : null,
  };
}
