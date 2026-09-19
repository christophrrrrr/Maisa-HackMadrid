import { spawn } from "node:child_process";
import path from "node:path";
import { pythonCmd, repoRoot } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/run?today=YYYY-MM-DD&limit=N
// Streams the pipeline's per-file JSON progress as Server-Sent Events.
// Always processes outputs/inbox (the files the console just uploaded).
// The extractor (hybrid + Gemini vision) is chosen by the pipeline from policy.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = url.searchParams.get("today") || "";
  const limit = url.searchParams.get("limit") || "";

  const args = ["-m", "src.pipeline", "--stream", "--dir", path.join(repoRoot(), "outputs", "inbox")];
  if (today) args.push("--today", today);
  if (limit) args.push("--limit", limit);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const child = spawn(pythonCmd(), args, { cwd: repoRoot() });
      let buf = "";

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            send(JSON.parse(t));
          } catch {
            send({ event: "log", message: t });
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) =>
        send({ event: "log", level: "stderr", message: chunk.toString("utf-8") })
      );
      child.on("error", (err) => {
        send({ event: "error", message: String(err) });
        controller.close();
      });
      child.on("close", (code) => {
        if (buf.trim()) {
          try { send(JSON.parse(buf.trim())); } catch { /* ignore */ }
        }
        send({ event: "closed", code });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
