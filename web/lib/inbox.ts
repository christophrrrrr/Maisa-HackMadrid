import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getPolicy, repoRoot } from "./python";
import { imageMaxMb, matchesExt, suffixesOf, withFileDefaults } from "./files";
import type { ScheduledJob } from "./types";

export function inboxDir(): string {
  return path.join(repoRoot(), "outputs", "inbox");
}

export function archiveDir(): string {
  return path.join(repoRoot(), "outputs", "facturas");
}

export function scheduledRoot(): string {
  return path.join(repoRoot(), "outputs", "scheduled");
}

function jobsPath(): string {
  return path.join(scheduledRoot(), "jobs.json");
}

export function safeName(name: string): string {
  return path.basename(name)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._\- ()\[\]]/gu, "_");
}

export function fileLimits() {
  let exts = [".pdf"];
  let maxMb = 12;
  try {
    const policy = withFileDefaults(getPolicy());
    exts = suffixesOf(policy);
    maxMb = imageMaxMb(policy);
  } catch {
    /* keep pdf-only */
  }
  return { exts, maxMb };
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"];

export async function resetInbox(): Promise<string> {
  const dest = inboxDir();
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await mkdir(archiveDir(), { recursive: true });
  return dest;
}

export async function writeNamed(dir: string, name: string, buf: Buffer): Promise<string> {
  const file = safeName(name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), buf);
  return file;
}

export async function saveInvoice(name: string, buf: Buffer, dest = inboxDir()): Promise<string> {
  const file = await writeNamed(dest, name, buf);
  await writeNamed(archiveDir(), file, buf);
  return file;
}

export async function collectFormFiles(form: FormData): Promise<{ name: string; buf: Buffer }[]> {
  const { exts, maxMb } = fileLimits();
  const cap = maxMb * 1024 * 1024;
  const out: { name: string; buf: Buffer }[] = [];
  for (const item of form.getAll("files")) {
    if (typeof item === "string") continue;
    const name = safeName(item.name);
    if (!matchesExt(name, exts)) continue;
    const buf = Buffer.from(await item.arrayBuffer());
    if (IMAGE_EXTS.some((e) => name.toLowerCase().endsWith(e)) && buf.length > cap) continue;
    out.push({ name, buf });
  }
  return out;
}

export async function readJobs(): Promise<ScheduledJob[]> {
  if (!existsSync(jobsPath())) return [];
  try {
    const raw = JSON.parse(await readFile(jobsPath(), "utf-8")) as ScheduledJob[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function writeJobs(jobs: ScheduledJob[]): Promise<void> {
  await mkdir(scheduledRoot(), { recursive: true });
  await writeFile(jobsPath(), JSON.stringify(jobs, null, 2), "utf-8");
}

export function jobDir(id: string): string {
  return path.join(scheduledRoot(), id);
}

export async function removeJobFiles(id: string): Promise<void> {
  await rm(jobDir(id), { recursive: true, force: true });
}

export async function stageJob(id: string): Promise<string[]> {
  const dest = await resetInbox();
  const src = jobDir(id);
  if (!existsSync(src)) return [];
  const names = (await readdir(src)).filter((name) => name !== "jobs.json");
  const files: string[] = [];
  for (const name of names) {
    const buf = await readFile(path.join(src, name));
    files.push(await saveInvoice(name, buf, dest));
  }
  return files;
}
