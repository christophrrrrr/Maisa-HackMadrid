"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Progress = { done: number; total: number; running: boolean };

export default function RunButton({ today = "2026-09-18" }: { today?: string }) {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ done: 0, total: 0, running: false });
  const [log, setLog] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);

  function pushLog(line: string) {
    setLog((l) => [...l.slice(-120), line]);
  }

  function run() {
    if (p.running) return;
    setLog([]);
    setP({ done: 0, total: 0, running: true });
    const es = new EventSource(`/api/run?today=${encodeURIComponent(today)}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.event) {
        case "run_start":
          setP({ done: 0, total: m.total, running: true });
          pushLog(`▶ run ${m.run_id} · extractor=${m.extractor} · rules=${m.rules_version} · ${m.total} files`);
          break;
        case "extracted":
          setP((s) => ({ ...s, done: m.i, total: m.total }));
          if (!m.ok) pushLog(`… ${m.file_id} — low confidence (${m.latency_ms}ms)`);
          break;
        case "decided":
          pushLog(`✓ ${m.file_id} → ${m.result} (${m.reason})`);
          break;
        case "run_done":
          pushLog(`■ done in ${m.elapsed_s}s · ${m.files_per_s} files/s · ${JSON.stringify(m.summary)}`);
          break;
        case "closed":
          es.close();
          esRef.current = null;
          setP((s) => ({ ...s, running: false }));
          router.refresh(); // re-read the state on the server components
          break;
        case "error":
          pushLog(`✗ ${m.message}`);
          break;
        default:
          if (m.message) pushLog(m.message);
      }
    };
    es.onerror = () => {
      pushLog("✗ stream error");
      es.close();
      esRef.current = null;
      setP((s) => ({ ...s, running: false }));
      router.refresh();
    };
  }

  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;

  return (
    <div>
      <div className="progress-wrap">
        <button className="btn" onClick={run} disabled={p.running}>
          {p.running ? `Running… ${p.done}/${p.total}` : "▶ Run batch"}
        </button>
        {p.running && (
          <div className="bar" style={{ width: 220 }}>
            <i className="PAGAR" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {log.length > 0 && (
        <div className="log" style={{ marginTop: 12 }}>
          {log.join("\n")}
        </div>
      )}
    </div>
  );
}
