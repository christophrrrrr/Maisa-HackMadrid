import { buildInsights, euros } from "@/lib/insights";
import { getPolicyOrNull, getState } from "@/lib/python";

export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  const { decisions } = getState();
  const { suppliers } = buildInsights(decisions, getPolicyOrNull());

  return (
    <div>
      <div className="page-heading">
        <h1>Proveedores</h1>
        <div className="subtitle">Proveedores con facturas pendientes de revisión</div>
      </div>

      <div className="card hist-card">
        <div className="hist-scroll">
          <table className="sup-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>NIF</th>
                <th className="hist-num">En revisión</th>
                <th className="hist-num">Importe</th>
                <th>Hallazgo más frecuente</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.key}>
                  <td>{supplier.name}</td>
                  <td className="mono">{supplier.nif}</td>
                  <td className="hist-num">{supplier.escalar}</td>
                  <td className="mono hist-num">{euros(supplier.euros)}</td>
                  <td className="muted">{supplier.topFinding}</td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty-cell">
                    No hay proveedores con facturas en revisión.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
