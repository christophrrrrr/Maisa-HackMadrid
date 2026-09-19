import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getPolicy, repoRoot } from "@/lib/python";
import { imageMaxMb, matchesExt, suffixesOf, withFileDefaults } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inboxDir(): string {
  return path.join(repoRoot(), "outputs", "inbox");
}

function archiveDir(): string {
  return path.join(repoRoot(), "outputs", "facturas");
}

function safeName(name: string): string {
  return path.basename(name)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._\- ()\[\]]/gu, "_");
}

export async function POST(req: Request) {
  try {
    let exts = [".pdf"];
    let maxMb = 12;
    try {
      const policy = withFileDefaults(getPolicy());
      exts = suffixesOf(policy);
      maxMb = imageMaxMb(policy);
    } catch {
      /* keep pdf-only */
    }
    const cap = maxMb * 1024 * 1024;
    const image = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"];

    const form = await req.formData();
    const dest = inboxDir();
    const archive = archiveDir();
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await mkdir(archive, { recursive: true });

    const files: string[] = [];
    for (const item of form.getAll("files")) {
      if (typeof item === "string") continue;
      const name = safeName(item.name);
      if (!matchesExt(name, exts)) continue;
      const buf = Buffer.from(await item.arrayBuffer());
      if (image.some((e) => name.toLowerCase().endsWith(e)) && buf.length > cap) continue;
      await writeFile(path.join(dest, name), buf);
      await writeFile(path.join(archive, name), buf);
      files.push(name);
    }
    return NextResponse.json({ dir: dest, files });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
