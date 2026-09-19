import { execFileSync } from "node:child_process";
import path from "node:path";
import type { StateSnapshot, Decision, Policy } from "./types";

// The Python backend lives in the repo root (parent of web/). `next dev` runs
// with cwd = web/, so the repo root is one level up. Override with REPO_ROOT.
export function repoRoot(): string {
  return process.env.REPO_ROOT || path.resolve(process.cwd(), "..");
}

export function pythonCmd(): string {
  return process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
}

/** Run a Python module and parse its stdout as JSON. Reads are cheap & synchronous. */
function pyJson<T>(args: string[]): T {
  const out = execFileSync(pythonCmd(), args, {
    cwd: repoRoot(),
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out) as T;
}

export function getState(): StateSnapshot {
  try {
    return pyJson<StateSnapshot>(["-m", "src.state", "json"]);
  } catch {
    // no run yet / DB missing - return an empty shell so the UI still renders
    return { latest_run: null, summary: { total: 0, PAGAR: 0, NO_PAGAR: 0, ESCALAR: 0 }, decisions: [] };
  }
}

export function getDecision(fileId: string): Decision | null {
  try {
    return pyJson<Decision | null>(["-m", "src.state", "decision", "--file-id", fileId]);
  } catch {
    return null;
  }
}

export function getPolicy(): Policy {
  return pyJson<Policy>(["-m", "src.policy", "get"]);
}

/** persist a (partial) policy update by piping json to `python -m src.policy set`. */
export function savePolicy(patch: Partial<Policy>): Policy {
  const out = execFileSync(pythonCmd(), ["-m", "src.policy", "set"], {
    cwd: repoRoot(),
    encoding: "utf-8",
    input: JSON.stringify(patch),
    maxBuffer: 8 * 1024 * 1024,
  });
  JSON.parse(out);
  return getPolicy();
}

export function clearState(): { ok: boolean } {
  return pyJson<{ ok: boolean }>(["-m", "src.state", "clear"]);
}
