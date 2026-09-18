import { NextResponse } from "next/server";
import { getState } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getState());
}
