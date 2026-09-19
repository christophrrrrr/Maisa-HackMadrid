import { NextResponse } from "next/server";
import { clearState, deleteRun, getState } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getState());
}

export async function DELETE(req: Request) {
  try {
    const runId = new URL(req.url).searchParams.get("run_id");
    if (runId) {
      const result = deleteRun(runId);
      if (!result.ok) return NextResponse.json(result, { status: 404 });
      return NextResponse.json(result);
    }
    return NextResponse.json(clearState());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
