import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { repoRoot } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inboxDir(): string {
  return path.join(repoRoot(), "outputs", "inbox");
}

function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ()[\]]/g, "_");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const dest = inboxDir();
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });

    const files: string[] = [];
    for (const item of form.getAll("files")) {
      if (typeof item === "string") continue;
      const name = safeName(item.name);
      if (!name.toLowerCase().endsWith(".pdf")) continue;
      const buf = Buffer.from(await item.arrayBuffer());
      await writeFile(path.join(dest, name), buf);
      files.push(name);
    }
    return NextResponse.json({ dir: dest, files });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
