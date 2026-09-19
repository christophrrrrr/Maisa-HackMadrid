import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const isWindows = process.platform === "win32";
const venvPython = path.join(
  repoRoot,
  ".venv",
  isWindows ? "Scripts/python.exe" : "bin/python",
);
const nextBin = path.join(
  webRoot,
  "node_modules",
  ".bin",
  isWindows ? "next.cmd" : "next",
);
const erpUrl = "http://127.0.0.1:8009/erp/estado";

let erpProcess = null;
let nextProcess = null;
let stopping = false;

async function requireFile(file, hint) {
  try {
    await access(file);
  } catch {
    throw new Error(`${hint}\nNo se encontro: ${file}`);
  }
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function erpIsReady() {
  try {
    const response = await fetch(erpUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForErp(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await erpIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`El ERP no respondio en ${erpUrl} tras ${timeoutMs / 1_000}s.`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} termino con codigo ${code ?? signal ?? "desconocido"}.`));
    });
  });
}

async function erpHasLote2Update() {
  try {
    const response = await fetch(erpUrl, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const text = await response.text();
    return /<actualizacion_cargada>\s*SI\s*<\/actualizacion_cargada>/i.test(text);
  } catch {
    return false;
  }
}

async function killPort(port) {
  try {
    if (isWindows) {
      await run("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      ]);
    } else {
      await run("sh", ["-c", `fuser -k ${port}/tcp >/dev/null 2>&1 || true`]);
    }
  } catch {
    // nothing listening, or no permission — waitForErp will fail loudly later
  }
}

async function startErp() {
  const lote2Csv = path.join(repoRoot, "lote_2_sorpresa", "erp_export_lote2.csv");
  const erpArgs = ["challenge/alberto_erp.py", "--rapido"];
  if (await fileExists(lote2Csv)) {
    erpArgs.push("--lote2", lote2Csv);
    console.log("[startup] Cargando actualizacion de lote 2 en el ERP.");
  }
  erpProcess = spawn(venvPython, erpArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  erpProcess.once("error", (error) => {
    console.error(`[startup] No se pudo arrancar el ERP: ${error.message}`);
    stop(1);
  });
  await waitForErp();
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (nextProcess && !nextProcess.killed) nextProcess.kill("SIGTERM");
  if (erpProcess && !erpProcess.killed) erpProcess.kill("SIGTERM");
  process.exitCode = exitCode;
}

async function main() {
  await requireFile(
    venvPython,
    "Falta el entorno Python. Ejecuta `uv venv && uv pip install -r requirements.txt` desde la raiz.",
  );
  await requireFile(
    nextBin,
    "Faltan las dependencias web. Ejecuta `npm ci` dentro de `web/`.",
  );

  const lote2Csv = path.join(repoRoot, "lote_2_sorpresa", "erp_export_lote2.csv");
  const wantLote2 = await fileExists(lote2Csv);

  if (await erpIsReady()) {
    if (wantLote2 && !(await erpHasLote2Update())) {
      console.log("[startup] ERP en marcha sin actualizacion de lote 2. Reiniciando con el CSV de sabado...");
      await killPort(8009);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await startErp();
    } else {
      console.log(`[startup] ERP disponible en ${erpUrl}`);
    }
  } else {
    console.log("[startup] Arrancando ERP local...");
    await startErp();
  }

  console.log("[startup] Actualizando snapshot del ERP...");
  await run(venvPython, ["-m", "src.erp_snapshot", "--quiet"], { cwd: repoRoot });

  console.log("[startup] Arrancando la consola web...");
  nextProcess = spawn(nextBin, ["dev", "-p", "3000"], {
    cwd: webRoot,
    stdio: "inherit",
    // Node >=20 on Windows refuses to spawn a .cmd/.bat shim without a shell
    // (EINVAL); run through the shell there. On POSIX the bin is a real exec.
    shell: isWindows,
    env: {
      ...process.env,
      PYTHON: venvPython,
      REPO_ROOT: repoRoot,
    },
  });
  nextProcess.once("error", (error) => {
    console.error(`[startup] No se pudo arrancar Next.js: ${error.message}`);
    stop(1);
  });
  nextProcess.once("close", (code) => stop(code ?? 1));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(0));
}

main().catch((error) => {
  console.error(`[startup] ${error.message}`);
  stop(1);
});
