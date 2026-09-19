import ProvidersTable from "@/components/ProvidersTable";
import { buildInsights } from "@/lib/insights";
import { getPolicyOrNull, getState } from "@/lib/python";

export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  const { decisions } = getState();
  const { suppliers } = buildInsights(decisions, getPolicyOrNull());

  return (
    <div>
      <div className="page-heading">
        <h1>Proveedores</h1>
      </div>
      <ProvidersTable suppliers={suppliers} />
    </div>
  );
}
