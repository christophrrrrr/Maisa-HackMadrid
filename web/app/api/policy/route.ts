import { NextResponse } from "next/server";
import { getPolicy, savePolicy } from "@/lib/python";
import type { Policy } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(getPolicy());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const patch = (await req.json()) as Partial<Policy>;
    return NextResponse.json(savePolicy(patch));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
