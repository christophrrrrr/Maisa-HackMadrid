import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".xml": "application/xml",
  ".xsig": "application/xml",
};

function safeFileName(raw: string): string | null {
  const name = path.basename(decodeURIComponent(raw));
  const ext = path.extname(name).toLowerCase();
  if (!MIME[ext]) return null;
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  return name;
}

async function resolveFile(name: string): Promise<string | null> {
  const root = repoRoot();
  const candidates = [
    path.join(root, "outputs", "inbox", name),
    path.join(root, "outputs", "facturas", name),
    path.join(root, "challenge", "facturas", name),
    path.join(root, "lote_2_sorpresa", "facturas", name),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: { fileId: string } }) {
  const name = safeFileName(params.fileId);
  if (!name) return new Response("invalid file", { status: 400 });
  const file = await resolveFile(name);
  if (!file) return new Response("not found", { status: 404 });

  const buf = await readFile(file);
  const ext = path.extname(name).toLowerCase();
  return new Response(buf, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
