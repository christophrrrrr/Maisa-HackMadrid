import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { StateSnapshot, Decision, Policy, RunRow, RunDiff } from "./types";

// The Python backend lives in the repo root (parent of web/). `next dev` runs
// with cwd = web/, so the repo root is one level up. Override with REPO_ROOT.
export function repoRoot(): string {
  return process.env.REPO_ROOT || path.resolve(process.cwd(), "..");
}

export function pythonCmd(): string {
  if (process.env.PYTHON) return path.resolve(process.env.PYTHON);

  const venvPython = path.join(
    repoRoot(),
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );

  return existsSync(venvPython)
    ? venvPython
    : process.platform === "win32"
      ? "python"
      : "python3";
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
    const snap = pyJson<StateSnapshot>(["-m", "src.state", "json"]);
    return {
      ...snap,
      recent_runs: snap.recent_runs ?? (snap.latest_run ? [snap.latest_run] : []),
    };
  } catch {
    // no run yet / DB missing - return an empty shell so the UI still renders
    return {
      latest_run: null,
      recent_runs: [],
      summary: { total: 0, PAGAR: 0, NO_PAGAR: 0, ESCALAR: 0 },
      decisions: [],
    };
  }
}

export function getHistory(opts?: { runId?: string; limit?: number }): Decision[] {
  try {
    const args = ["-m", "src.state", "history", "--limit", String(opts?.limit ?? 500)];
    if (opts?.runId) args.push("--run-id", opts.runId);
    return pyJson<Decision[]>(args);
  } catch {
    return [];
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

export function getPolicyOrNull(): Policy | null {
  try {
    return getPolicy();
  } catch {
    return null;
  }
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

/** all runs (newest first) for the change-diff run picker. */
export function getRuns(): RunRow[] {
  try {
    return pyJson<RunRow[]>(["-m", "src.state", "runs"]);
  } catch {
    return [];
  }
}

/** compare two runs (a = before, b = after) over the immutable decision history. */
export function getDiff(runA: string, runB: string): RunDiff | null {
  try {
    return pyJson<RunDiff>(["-m", "src.state", "diff", "--run-a", runA, "--run-b", runB]);
  } catch {
    return null;
  }
}

export function deleteRun(runId: string): { ok: boolean; error?: string; run_id?: string } {
  return pyJson(["-m", "src.state", "delete", "--run-id", runId]);
}
