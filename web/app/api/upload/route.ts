import { NextResponse } from "next/server";
import { collectFormFiles, resetInbox, saveInvoice } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const incoming = await collectFormFiles(form);
    if (incoming.length === 0) {
      return NextResponse.json(
        { error: "No hay archivos soportados para procesar." },
        { status: 400 },
      );
    }
    const dest = await resetInbox();
    const files: string[] = [];
    for (const file of incoming) {
      files.push(await saveInvoice(file.name, file.buf, dest));
    }
    return NextResponse.json({ dir: dest, files });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
