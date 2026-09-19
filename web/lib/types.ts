export type Result = "PAGAR" | "NO_PAGAR" | "ESCALAR";

export interface Decision {
  file_id: string;
  run_id: string;
  result: Result;
  reason: string;
  findings: string[];
  evidence: Record<string, unknown>;
  rules_version: string;
  extraction_method: string | null;
  extraction_ok: boolean;
  extracted: Record<string, unknown> | null;
  latency_ms: number | null;
  cost_usd: number;
  updated_at: string;
}

export interface RunRow {
  run_id: string;
  batch: string;
  rules_version: string;
  status: string;
  total: number;
  n_pagar: number;
  n_no_pagar: number;
  n_escalar: number;
  started_at: string;
  finished_at: string | null;
  elapsed_s: number | null;
  files_per_s: number | null;
  cost_usd: number;
  stats: Record<string, unknown> | string;
}

export interface StateSnapshot {
  latest_run: RunRow | null;
  summary: { total: number; PAGAR: number; NO_PAGAR: number; ESCALAR: number };
  decisions: Decision[];
}

export type FileKind = "pdf" | "image" | "xml";

export interface FileTypeConfig {
  enabled: boolean;
  vision?: boolean;
  max_mb?: number;
  facturae?: boolean;
}

export interface FileTypeMeta {
  label: string;
  exts: string[];
  help: string;
}

export interface WatchConfig {
  enabled: boolean;
  folder_name: string | null;
}

export interface Policy {
  rules_version: string;
  tolerance: string;
  extractor: string;
  today: string | null;
  reason_outcomes: Record<string, Result>;
  reasons: Record<string, { label: string; rule: string; help: string }>;
  results: Result[];
  file_types: Record<FileKind, FileTypeConfig>;
  file_type_meta: Record<FileKind, FileTypeMeta>;
  watch: WatchConfig;
}
