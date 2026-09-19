import { NextResponse } from "next/server";
import { getDiff } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const a = searchParams.get("a");
  const b = searchParams.get("b");
  if (!a || !b) {
    return NextResponse.json({ error: "missing run ids (a, b)" }, { status: 400 });
  }
  const diff = getDiff(a, b);
  if (!diff) {
    return NextResponse.json({ error: "could not compute diff" }, { status: 500 });
  }
  return NextResponse.json(diff);
}
