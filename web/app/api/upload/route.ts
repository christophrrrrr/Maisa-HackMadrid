import { NextResponse } from "next/server";
import { collectFormFiles, resetInbox, saveInvoice } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const dest = await resetInbox();
    const files: string[] = [];
    for (const file of await collectFormFiles(form)) {
      files.push(await saveInvoice(file.name, file.buf, dest));
    }
    return NextResponse.json({ dir: dest, files });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
