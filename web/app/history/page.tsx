import DecisionHistory from "@/components/DecisionHistory";
import { getHistory, getState } from "@/lib/python";

export const dynamic = "force-dynamic";

export default function HistoryPage({
  searchParams,
}: {
  searchParams?: { run?: string | string[] };
}) {
  const { recent_runs } = getState();
  const decisions = getHistory({ limit: 1000 });
  const requestedRun = typeof searchParams?.run === "string" ? searchParams.run : "";
  const initialRunId = recent_runs.some((run) => run.run_id === requestedRun) ? requestedRun : "ALL";

  return (
    <div>
      <div className="page-heading">
        <h1>Historial</h1>
      </div>
      <DecisionHistory
        decisions={decisions}
        runs={recent_runs}
        showHeader={false}
        initialRunId={initialRunId}
      />
    </div>
  );
}
