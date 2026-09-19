import DecisionHistory from "@/components/DecisionHistory";
import { getHistory, getState } from "@/lib/python";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const { recent_runs } = getState();
  const decisions = getHistory({ limit: 1000 });

  return (
    <div>
      <div className="page-heading">
        <h1>Historial</h1>
        <div className="subtitle">Registro auditable de decisiones por ejecución</div>
      </div>
      <DecisionHistory decisions={decisions} runs={recent_runs} showHeader={false} />
    </div>
  );
}
