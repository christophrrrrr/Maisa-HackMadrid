import { NextResponse } from "next/server";
import { clearState, getState } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getState());
}

export async function DELETE() {
  try {
    return NextResponse.json(clearState());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
