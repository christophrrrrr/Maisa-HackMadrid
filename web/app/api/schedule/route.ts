import { mkdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  collectFormFiles, jobDir, readJobs, removeJobFiles, writeJobs, writeNamed,
} from "@/lib/inbox";
import type { ScheduledJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = (await readJobs()).sort((a, b) => a.when.localeCompare(b.when));
  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const whenRaw = String(form.get("when") || "");
    const whenDate = new Date(whenRaw);
    if (!whenRaw || Number.isNaN(whenDate.getTime())) {
      return NextResponse.json({ error: "Indique una fecha v\u00e1lida." }, { status: 400 });
    }
    const filesIn = await collectFormFiles(form);
    if (filesIn.length === 0) {
      return NextResponse.json({ error: "Seleccione al menos un archivo." }, { status: 400 });
    }
    const id = randomUUID();
    const dest = jobDir(id);
    await mkdir(dest, { recursive: true });
    const files: string[] = [];
    for (const file of filesIn) {
      files.push(await writeNamed(dest, file.name, file.buf));
    }
    const job: ScheduledJob = {
      id,
      when: whenDate.toISOString(),
      files,
      created_at: new Date().toISOString(),
    };
    const jobs = await readJobs();
    jobs.push(job);
    await writeJobs(jobs);
    return NextResponse.json(job);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el identificador." }, { status: 400 });
  const jobs = (await readJobs()).filter((job) => job.id !== id);
  await writeJobs(jobs);
  await removeJobFiles(id);
  return NextResponse.json({ ok: true, id });
}
