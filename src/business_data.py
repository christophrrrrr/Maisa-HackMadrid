"""Business-data adapter (Person B, part 1).

Loads the ONE useful part of the chaotic Excel — the supplier master, the 2026
purchase orders, and the payment rules text — into clean lookups. Ignores the
~11 junk/trap sheets. De-dups the duplicated P007 master row.

Everything the rules engine needs about "who is a real supplier / what was
ordered" comes from here; "was it already paid / still pending" comes from the
ERP snapshot (Person C).
"""
from __future__ import annotations

import csv
import re
import unicodedata
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

import openpyxl

from .models import PurchaseOrder, Supplier

DEFAULT_XLSX = Path(__file__).resolve().parents[1] / "challenge" / "FINAL_v7_DEFINITIVO_ahorasi.xlsx"

SHEET_SUPPLIERS = "Proveedores"
SHEET_ORDERS = "Pedidos_2026"
DEFAULT_RULES_VERSION = "norma-v3"


def rules_sheet_for_version(rules_version: str) -> str:
    """Map the canonical version label to the workbook sheet name."""
    prefix = "norma-v"
    if not rules_version.startswith(prefix) or not rules_version[len(prefix):].isdigit():
        raise ValueError(f"invalid rules version {rules_version!r}; expected norma-vN")
    return f"Norma_Pagos_v{rules_version[len(prefix):]}"


def _latest_norma_sheet(sheetnames: list[str]) -> str | None:
    """Highest-numbered ``Norma_Pagos_vN`` sheet present, used as a TEXT fallback
    when the exact requested norma sheet was not shipped in the workbook."""
    best: tuple[int, str] | None = None
    for name in sheetnames:
        match = re.fullmatch(r"norma_pagos_v(\d+)", _norm_header(name))
        if match:
            number = int(match.group(1))
            if best is None or number > best[0]:
                best = (number, name)
    return best[1] if best else None

# --- schema resilience -------------------------------------------------------
# The master Excel is human-maintained, so its LAYOUT can drift (a column gets
# renamed / reordered, a sheet gets a slightly different name). We resolve
# columns by HEADER NAME (accent/case/space-insensitive) instead of by fixed
# position, so re-ordering or renaming a column no longer silently reads the
# wrong data. If a *required* sheet or column can't be located we raise a clear,
# actionable BusinessDataError instead of guessing.


class BusinessDataError(ValueError):
    """The master Excel is structurally unreadable (missing sheet/column)."""


# sheet-name aliases (normalised); the preferred name is tried first.
SUPPLIER_SHEET_ALIASES = ["proveedores", "proveedor", "suppliers", "maestro_proveedores", "maestro"]
ORDER_SHEET_ALIASES = ["pedidos_2026", "pedidos", "orders", "po_2026", "pedidos2026"]

# field -> ordered header aliases (normalised). first match wins.
SUPPLIER_COLUMNS: dict[str, list[str]] = {
    "id": ["id", "id_proveedor", "codigo", "cod_proveedor", "proveedor_id", "proveedorid"],
    "name": ["razon_social", "nombre", "proveedor", "name"],
    "tax_id": ["nif", "cif", "nif_cif", "cif_nif", "tax_id", "identificacion_fiscal"],
    "iban": ["iban", "cuenta", "iban_cuenta", "cuenta_bancaria"],
    "payment_terms": ["condiciones", "condiciones_pago", "forma_pago", "terminos_pago", "payment_terms", "plazo", "plazo_pago"],
}
SUPPLIER_REQUIRED = ("id", "name", "tax_id", "iban")

ORDER_COLUMNS: dict[str, list[str]] = {
    "id": ["pedido", "id_pedido", "num_pedido", "numero_pedido", "orden", "po", "order_id"],
    "supplier_id": ["proveedorid", "proveedor_id", "id_proveedor", "proveedor", "supplier_id"],
    "tax_id": ["nif", "cif", "tax_id"],
    "amount": ["importe_total", "importe", "total", "amount", "monto", "importe_pedido"],
}
ORDER_REQUIRED = ("id", "supplier_id", "amount")


def _norm_header(value: object) -> str:
    """Fold a header cell to a comparable key: lowercase, strip accents, snake_case."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def _find_sheet(wb, preferred: str, aliases: list[str], warnings: list[str], label: str):
    """Locate a sheet by its preferred name, then by normalised aliases."""
    if preferred in wb.sheetnames:
        return wb[preferred]
    norm_to_actual = {_norm_header(name): name for name in wb.sheetnames}
    for alias in aliases:
        actual = norm_to_actual.get(alias)
        if actual:
            warnings.append(f"hoja de {label}: se esperaba '{preferred}', se uso '{actual}'")
            return wb[actual]
    raise BusinessDataError(
        f"no se encontro la hoja de {label} (esperaba '{preferred}' o similar). "
        f"hojas disponibles: {', '.join(wb.sheetnames)}"
    )


def _header_index(ws) -> dict[str, int]:
    """Map each normalised header in row 1 to its column position (first wins)."""
    for row in ws.iter_rows(min_row=1, max_row=1, values_only=True):
        idx: dict[str, int] = {}
        for i, cell in enumerate(row):
            key = _norm_header(cell)
            if key and key not in idx:
                idx[key] = i
        return idx
    return {}


def _resolve_columns(
    header_idx: dict[str, int],
    columns: dict[str, list[str]],
    required: tuple[str, ...],
    label: str,
) -> dict[str, int]:
    """Resolve field -> column index via header aliases; error if a required one is missing."""
    resolved: dict[str, int] = {}
    for field_name, aliases in columns.items():
        for alias in aliases:
            if alias in header_idx:
                resolved[field_name] = header_idx[alias]
                break
    missing = [f for f in required if f not in resolved]
    if missing:
        raise BusinessDataError(
            f"la hoja de {label} no tiene columna(s) reconocible(s) para {missing}. "
            f"cabeceras encontradas: {sorted(header_idx)}"
        )
    return resolved


def _cell(row: tuple, idx: int | None):
    """Safe positional read: tolerate short rows and unresolved (optional) columns."""
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def normalize_iban(iban: str | None) -> str | None:
    if iban is None:
        return None
    return re.sub(r"\s+", "", str(iban)).upper()


def normalize_tax_id(value: str | None) -> str | None:
    """Strip punctuation/spaces so foreign tax ids still match the master.

    Brazilian CNPJ ships as ``12.345.678/0001-95``; vision often returns digits
    only. Spanish NIFs like ``A41220987`` are unchanged.
    """
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9A-Za-z]", "", str(value)).upper()
    return cleaned or None


def _index_supplier_nif(
    suppliers_by_nif: dict[str, "Supplier"],
    supplier: "Supplier",
    warnings: list[str],
    source: str = "",
) -> None:
    raw = (supplier.tax_id or "").strip()
    if not raw:
        return
    keys = {raw}
    normalized = normalize_tax_id(raw)
    if normalized:
        keys.add(normalized)
    where = f" ({source})" if source else ""
    for key in keys:
        existing = suppliers_by_nif.get(key)
        if existing is not None and existing.id != supplier.id:
            warnings.append(
                f"NIF {raw}{where} apunta a mas de un proveedor - se conservo {existing.id}"
            )
            continue
        suppliers_by_nif[key] = supplier


def _to_decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        # Excel gives floats; str() gives the shortest exact repr (10325.9 -> "10325.9")
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


# --- external sources (CSV) --------------------------------------------------
# New suppliers / purchase orders can arrive as separate CSVs (e.g. lote 2's
# proveedores_nuevos.csv / pedidos_nuevos.csv) instead of being folded into the
# master Excel. These helpers ingest ANY such source through the SAME header-alias
# resolution the Excel uses, so a new file with slightly different column names
# still lands correctly. Merges are ADDITIVE: a brand-new id is added; an id that
# already exists in the master is NOT overwritten — identical rows are de-duped
# silently and genuinely conflicting rows keep the vetted master value and raise
# a loud warning (rule 6: surface anomalies for a human).


def _read_csv_rows(
    path: Path,
    columns: dict[str, list[str]],
    required: tuple[str, ...],
    label: str,
    warnings: list[str],
) -> Iterator[dict[str, object]]:
    """Yield ``{field: raw_value}`` dicts from a CSV, resolving columns by header
    NAME (accent/case/space-insensitive) exactly like the Excel loader."""
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            warnings.append(f"fuente de {label} vacia: {path.name}")
            return
        header_idx: dict[str, int] = {}
        for i, cell in enumerate(header):
            key = _norm_header(cell)
            if key and key not in header_idx:
                header_idx[key] = i
        col = _resolve_columns(header_idx, columns, required, f"{label} ({path.name})")
        for row in reader:
            yield {field: (row[idx] if idx < len(row) else None) for field, idx in col.items()}


def _merge_supplier_source(
    path: Path,
    suppliers_by_id: dict[str, "Supplier"],
    suppliers_by_nif: dict[str, "Supplier"],
    warnings: list[str],
) -> None:
    for raw in _read_csv_rows(path, SUPPLIER_COLUMNS, SUPPLIER_REQUIRED, "proveedores", warnings):
        sid = str(raw.get("id") or "").strip()
        if not sid:
            continue
        name = raw.get("name")
        tax_id = raw.get("tax_id")
        iban = raw.get("iban")
        terms = raw.get("payment_terms")
        supplier = Supplier(
            id=sid,
            name=str(name).strip() if name else "",
            tax_id=str(tax_id).strip() if tax_id else "",
            iban=normalize_iban(iban) or "",
            payment_terms=str(terms).strip() if terms else None,
        )
        if supplier.id in suppliers_by_id:
            existing = suppliers_by_id[supplier.id]
            if existing.model_dump() != supplier.model_dump():
                warnings.append(
                    f"proveedor {supplier.id} de {path.name} EN CONFLICTO con el maestro - "
                    f"se conservo el del Excel"
                )
            else:
                warnings.append(f"proveedor {supplier.id} de {path.name} duplicado (identico) - de-duplicado")
            continue
        suppliers_by_id[supplier.id] = supplier
        _index_supplier_nif(suppliers_by_nif, supplier, warnings, path.name)


def _merge_order_source(
    path: Path,
    orders: dict[str, "PurchaseOrder"],
    warnings: list[str],
) -> None:
    for raw in _read_csv_rows(path, ORDER_COLUMNS, ORDER_REQUIRED, "pedidos", warnings):
        pedido = str(raw.get("id") or "").strip()
        if not pedido:
            continue
        amount = _to_decimal(raw.get("amount"))
        if amount is None:
            warnings.append(f"pedido {pedido} ({path.name}) con importe no interpretable {raw.get('amount')!r} - omitido")
            continue
        supplier_id = raw.get("supplier_id")
        tax_id = raw.get("tax_id")
        order = PurchaseOrder(
            id=pedido,
            supplier_id=str(supplier_id).strip() if supplier_id else "",
            tax_id=str(tax_id).strip() if tax_id else None,
            amount=amount,
        )
        if order.id in orders:
            existing = orders[order.id]
            if existing.model_dump() != order.model_dump():
                warnings.append(
                    f"pedido {order.id} de {path.name} EN CONFLICTO con el maestro - se conservo el del Excel"
                )
            else:
                warnings.append(f"pedido {order.id} de {path.name} duplicado (identico) - de-duplicado")
            continue
        orders[order.id] = order


@dataclass
class BusinessData:
    suppliers_by_id: dict[str, Supplier]
    suppliers_by_nif: dict[str, Supplier]
    orders: dict[str, PurchaseOrder]
    rules_version: str
    rules_text: list[str]
    warnings: list[str] = field(default_factory=list)

    def supplier_for_invoice(self, nif: str | None) -> Supplier | None:
        """Rule 1: a real supplier is matched by NIF (invoices carry NIF, not ID)."""
        if not nif:
            return None
        stripped = nif.strip()
        found = self.suppliers_by_nif.get(stripped)
        if found is not None:
            return found
        normalized = normalize_tax_id(stripped)
        if normalized and normalized != stripped:
            return self.suppliers_by_nif.get(normalized)
        return None

    def order(self, pedido: str | None) -> PurchaseOrder | None:
        if not pedido:
            return None
        return self.orders.get(pedido.strip())


def load_business_data(
    xlsx_path: Path = DEFAULT_XLSX,
    *,
    rules_version: str = DEFAULT_RULES_VERSION,
    extra_supplier_csvs: Sequence[Path] | None = None,
    extra_order_csvs: Sequence[Path] | None = None,
) -> BusinessData:
    rules_sheet = rules_sheet_for_version(rules_version)
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    warnings: list[str] = []

    # --- suppliers (master) ---
    suppliers_by_id: dict[str, Supplier] = {}
    suppliers_by_nif: dict[str, Supplier] = {}
    ws = _find_sheet(wb, SHEET_SUPPLIERS, SUPPLIER_SHEET_ALIASES, warnings, "proveedores")
    scol = _resolve_columns(_header_index(ws), SUPPLIER_COLUMNS, SUPPLIER_REQUIRED, "proveedores")
    for row in ws.iter_rows(min_row=2, values_only=True):
        sid = _cell(row, scol["id"])
        if not sid:
            continue
        name = _cell(row, scol["name"])
        tax_id = _cell(row, scol["tax_id"])
        iban = _cell(row, scol["iban"])
        terms = _cell(row, scol.get("payment_terms"))
        supplier = Supplier(
            id=str(sid).strip(),
            name=str(name).strip() if name else "",
            tax_id=str(tax_id).strip() if tax_id else "",
            iban=normalize_iban(iban) or "",
            payment_terms=str(terms).strip() if terms else None,
        )
        if supplier.id in suppliers_by_id:
            existing = suppliers_by_id[supplier.id]
            if existing.model_dump() != supplier.model_dump():
                warnings.append(f"proveedor {supplier.id} duplicado con datos EN CONFLICTO - se conservo el primero")
            else:
                warnings.append(f"proveedor {supplier.id} duplicado (identico) - de-duplicado")
            continue
        suppliers_by_id[supplier.id] = supplier
        _index_supplier_nif(suppliers_by_nif, supplier, warnings)

    # --- purchase orders ---
    orders: dict[str, PurchaseOrder] = {}
    ws = _find_sheet(wb, SHEET_ORDERS, ORDER_SHEET_ALIASES, warnings, "pedidos")
    ocol = _resolve_columns(_header_index(ws), ORDER_COLUMNS, ORDER_REQUIRED, "pedidos")
    for row in ws.iter_rows(min_row=2, values_only=True):
        pedido = _cell(row, ocol["id"])
        if not pedido:
            continue
        raw_amount = _cell(row, ocol["amount"])
        amount = _to_decimal(raw_amount)
        if amount is None:
            warnings.append(f"pedido {pedido} con importe no interpretable {raw_amount!r} - omitido")
            continue
        supplier_id = _cell(row, ocol["supplier_id"])
        tax_id = _cell(row, ocol.get("tax_id"))
        po = PurchaseOrder(
            id=str(pedido).strip(),
            supplier_id=str(supplier_id).strip() if supplier_id else "",
            tax_id=str(tax_id).strip() if tax_id else None,
            amount=amount,
        )
        if po.id in orders:
            warnings.append(f"pedido {po.id} aparece mas de una vez en la hoja de pedidos")
        orders[po.id] = po

    # --- rules text (kept for the pitch / versioning; the logic is coded in rules_engine) ---
    # If the requested norma sheet was not shipped in the workbook (e.g. norma-v4
    # was announced but the master Excel is unchanged), fall back to the most
    # recent norma sheet available for the human-readable TEXT and warn loudly.
    # The decision LOGIC for the requested version is selected in the rules engine;
    # this fallback only affects the rule text carried in the trace, so the batch
    # never crashes just because the text tab is missing.
    rules_text: list[str] = []
    resolved_rules_sheet = rules_sheet
    if rules_sheet not in wb.sheetnames:
        fallback = _latest_norma_sheet(wb.sheetnames)
        if fallback is None:
            wb.close()
            raise BusinessDataError(
                f"{xlsx_path} no contiene ninguna hoja de norma (se esperaba {rules_sheet!r}). "
                f"hojas disponibles: {', '.join(wb.sheetnames)}"
            )
        warnings.append(
            f"no se encontro la hoja {rules_sheet!r} para {rules_version}; "
            f"se usa el texto de '{fallback}' como referencia (la logica la decide el motor de reglas)"
        )
        resolved_rules_sheet = fallback
    for row in wb[resolved_rules_sheet].iter_rows(values_only=True):
        if row and row[0]:
            rules_text.append(str(row[0]).strip())

    wb.close()

    # --- merge additional external sources (new suppliers / orders as CSV) ---
    for source in extra_supplier_csvs or ():
        path = Path(source)
        if path.is_file():
            _merge_supplier_source(path, suppliers_by_id, suppliers_by_nif, warnings)
        else:
            warnings.append(f"fuente de proveedores no encontrada: {path}")
    for source in extra_order_csvs or ():
        path = Path(source)
        if path.is_file():
            _merge_order_source(path, orders, warnings)
        else:
            warnings.append(f"fuente de pedidos no encontrada: {path}")
    return BusinessData(
        suppliers_by_id=suppliers_by_id,
        suppliers_by_nif=suppliers_by_nif,
        orders=orders,
        rules_version=rules_version,
        rules_text=rules_text,
        warnings=warnings,
    )


def _main() -> int:
    biz = load_business_data()
    print(f"suppliers : {len(biz.suppliers_by_id)} (by NIF: {len(biz.suppliers_by_nif)})")
    print(f"orders    : {len(biz.orders)}")
    print(f"rules     : {biz.rules_version} ({len(biz.rules_text)} lines)")
    print(f"warnings  : {biz.warnings}")
    any_id = next(iter(biz.suppliers_by_id))
    print("sample supplier:", biz.suppliers_by_id[any_id].model_dump())
    any_po = next(iter(biz.orders))
    print("sample order   :", biz.orders[any_po].model_dump())
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
