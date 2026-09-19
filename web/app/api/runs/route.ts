import { NextResponse } from "next/server";
import { getRuns } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRuns());
}
