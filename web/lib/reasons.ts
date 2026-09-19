import type { Policy } from "./types";

export const REASON_LABELS: Record<string, string> = {
  all_rules_pass: "Todas las comprobaciones correctas",
  incomplete_extraction: "Extracción incompleta",
  supplier_not_in_master: "Proveedor no dado de alta",
  iban_mismatch: "IBAN no coincide",
  pedido_not_found: "Pedido no encontrado",
  pedido_supplier_mismatch: "Pedido de otro proveedor",
  amount_mismatch: "Importe no coincide",
  total_not_base_plus_iva: "Total distinto de base + IVA",
  iva_miscalculated: "IVA mal calculado",
  invalid_date: "Fecha no válida",
  future_date: "Fecha futura",
  pedido_not_in_erp: "Pedido ausente en el ERP",
  erp_amount_mismatch: "Importe distinto del ERP",
  erp_status_unexpected: "Estado ERP inesperado",
  already_paid: "Ya pagada",
  duplicate_pedido: "Pedido duplicado",
  out_of_scope: "No es una factura",
  unreadable: "Documento ilegible",
  unknown_format: "Formato no soportado",
};

export function reasonLabel(code: string | null | undefined, policy?: Policy | null): string {
  if (!code) return "";
  return policy?.reasons?.[code]?.label || REASON_LABELS[code] || code.replace(/_/g, " ");
}
