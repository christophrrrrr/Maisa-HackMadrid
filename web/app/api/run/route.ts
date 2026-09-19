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
  let child: ReturnType<typeof spawn> | null = null;
  let streamEnded = false;
  const stream = new ReadableStream({
    start(controller) {
      let processEnded = false;
      let stderr = "";
      let buf = "";

      const send = (obj: unknown) => {
        if (streamEnded) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // The browser may disconnect while Python is still shutting down.
          streamEnded = true;
        }
      };

      const finish = (code: number | null, spawnError?: unknown) => {
        if (processEnded) return;
        processEnded = true;

        if (buf.trim()) {
          try { send(JSON.parse(buf.trim())); } catch { send({ event: "log", message: buf.trim() }); }
        }
        if (code !== 0) {
          const detail = stderr.trim() || (spawnError ? String(spawnError) : "");
          send({
            event: "error",
            code,
            message: detail || `El pipeline termino con codigo ${code ?? "desconocido"}.`,
          });
        }
        send({ event: "closed", code });

        if (!streamEnded) {
          streamEnded = true;
          try { controller.close(); } catch { /* already closed by the client */ }
        }
      };

      const proc = spawn(pythonCmd(), args, {
        cwd: repoRoot(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = proc;

      proc.stdout.on("data", (chunk: Buffer) => {
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
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf-8")).slice(-16_000);
      });
      proc.once("error", (err) => {
        stderr = (stderr + `\n${String(err)}`).slice(-16_000);
        finish(null, err);
      });
      proc.once("close", (code) => {
        finish(code);
      });
    },
    cancel() {
      streamEnded = true;
      if (child && !child.killed) child.kill();
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
