import { NextResponse } from "next/server";
import { readJobs, removeJobFiles, stageJob, writeJobs } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Falta el identificador." }, { status: 400 });
    const jobs = await readJobs();
    const job = jobs.find((item) => item.id === id);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    const files = await stageJob(id);
    if (files.length === 0) {
      return NextResponse.json({ error: "El lote programado no tiene archivos." }, { status: 400 });
    }
    await writeJobs(jobs.filter((item) => item.id !== id));
    await removeJobFiles(id);
    return NextResponse.json({ ok: true, id, files });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
