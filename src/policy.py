"""editable payment policy - persisted overrides the rules engine reads at run time.

the console's settings page edits this; rules_engine + pipeline load it so changes
take effect on the next batch run. defaults live here; overrides in outputs/policy.json.
"""
from __future__ import annotations

import json
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[1] / "outputs" / "policy.json"

RULES_VERSION = "norma-v3"
DEFAULT_TOLERANCE = "0.01"
RESULTS = ["PAGAR", "NO_PAGAR", "ESCALAR"]

# reason code -> outcome when that check FAILS. this is the editable policy.
DEFAULT_REASON_OUTCOMES: dict[str, str] = {
    "incomplete_extraction": "ESCALAR",
    "supplier_not_in_master": "ESCALAR",
    "iban_mismatch": "ESCALAR",
    "pedido_not_found": "ESCALAR",
    "pedido_supplier_mismatch": "ESCALAR",
    "amount_mismatch": "ESCALAR",
    "total_not_base_plus_iva": "ESCALAR",
    "iva_miscalculated": "ESCALAR",
    "invalid_date": "ESCALAR",
    "future_date": "ESCALAR",
    "pedido_not_in_erp": "ESCALAR",
    "erp_amount_mismatch": "ESCALAR",
    "erp_status_unexpected": "ESCALAR",
    "already_paid": "NO_PAGAR",
    "duplicate_pedido": "NO_PAGAR",
}

# human metadata for the settings ui: label + which norma rule it maps to + help
REASONS: dict[str, dict[str, str]] = {
    "incomplete_extraction": {"label": "Extraccion incompleta", "rule": "filtro", "help": "el documento no se pudo leer con suficiente confianza"},
    "supplier_not_in_master": {"label": "Proveedor no dado de alta", "rule": "1", "help": "el NIF no figura en el maestro de proveedores"},
    "iban_mismatch": {"label": "IBAN no coincide", "rule": "1", "help": "el IBAN de la factura no coincide con el maestro"},
    "pedido_not_found": {"label": "Pedido no encontrado", "rule": "2", "help": "el pedido no existe en Pedidos_2026"},
    "pedido_supplier_mismatch": {"label": "Pedido de otro proveedor", "rule": "2", "help": "el pedido esta asignado a otro proveedor"},
    "amount_mismatch": {"label": "Importe no coincide", "rule": "2", "help": "el total de la factura no coincide con el pedido"},
    "total_not_base_plus_iva": {"label": "Total distinto de base + IVA", "rule": "3", "help": "la aritmetica de la factura no cuadra"},
    "iva_miscalculated": {"label": "IVA mal calculado", "rule": "3", "help": "la cuota de IVA no corresponde a la base por el tipo"},
    "invalid_date": {"label": "Fecha no valida", "rule": "4", "help": "no hay una fecha de emision valida"},
    "future_date": {"label": "Fecha futura", "rule": "4", "help": "la fecha de emision es posterior a la de referencia"},
    "pedido_not_in_erp": {"label": "Pedido ausente en el ERP", "rule": "5", "help": "no hay asiento contable para conciliar"},
    "erp_amount_mismatch": {"label": "Importe distinto del ERP", "rule": "5", "help": "el mayor no coincide con la factura"},
    "erp_status_unexpected": {"label": "Estado ERP inesperado", "rule": "5", "help": "el estado no es PENDIENTE ni PAGADA"},
    "already_paid": {"label": "Ya pagada", "rule": "5", "help": "el ERP marca el asiento como PAGADA"},
    "duplicate_pedido": {"label": "Pedido duplicado", "rule": "5", "help": "el mismo pedido aparece en mas de una factura"},
}


FILE_TYPE_META: dict[str, dict] = {
    "pdf": {"label": "PDF", "exts": [".pdf"], "help": "facturas digitales y escaneos"},
    "image": {
        "label": "Imagen",
        "exts": [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"],
        "help": "fotos y escaneos sueltos",
    },
    "xml": {"label": "XML", "exts": [".xml", ".xsig"], "help": "FacturaE / UBL"},
}

DEFAULT_FILE_TYPES: dict[str, dict] = {
    "pdf": {"enabled": True, "vision": True},
    "image": {"enabled": False, "vision": True, "max_mb": 12},
    "xml": {"enabled": False, "facturae": True},
}

DEFAULT_WATCH: dict = {"enabled": False, "folder_name": None}

PERSIST_KEYS = ("tolerance", "extractor", "today", "reason_outcomes", "file_types", "watch")


def defaults() -> dict:
    return {
        "rules_version": RULES_VERSION,
        "tolerance": DEFAULT_TOLERANCE,
        "extractor": "hybrid",  # A's digital+vision; 'baseline' is the offline fallback
        "today": None,  # reference date for rule 4; None = system today
        "reason_outcomes": dict(DEFAULT_REASON_OUTCOMES),
        "file_types": {k: dict(v) for k, v in DEFAULT_FILE_TYPES.items()},
        "watch": dict(DEFAULT_WATCH),
    }


def kind_for_suffix(suffix: str) -> str | None:
    s = suffix.lower()
    for key, meta in FILE_TYPE_META.items():
        if s in meta["exts"]:
            return key
    return None


def accepted_suffixes(cfg: dict | None = None) -> set[str]:
    cfg = cfg or load_policy()
    out: set[str] = set()
    types = cfg.get("file_types") or {}
    for key, spec in types.items():
        if spec.get("enabled") and key in FILE_TYPE_META:
            out.update(FILE_TYPE_META[key]["exts"])
    return out or {".pdf"}


def _merge_file_types(saved: object) -> dict:
    out = {k: dict(v) for k, v in DEFAULT_FILE_TYPES.items()}
    if not isinstance(saved, dict):
        return out
    for key, default in DEFAULT_FILE_TYPES.items():
        spec = saved.get(key)
        if not isinstance(spec, dict):
            continue
        out[key]["enabled"] = bool(spec.get("enabled", default["enabled"]))
        if "vision" in default:
            out[key]["vision"] = bool(spec.get("vision", default["vision"]))
        if "max_mb" in default:
            try:
                n = int(spec.get("max_mb", default["max_mb"]))
            except (TypeError, ValueError):
                n = int(default["max_mb"])
            out[key]["max_mb"] = max(1, min(n, 50))
        if "facturae" in default:
            out[key]["facturae"] = bool(spec.get("facturae", default["facturae"]))
    if not any(v.get("enabled") for v in out.values()):
        out["pdf"]["enabled"] = True
    return out


def _merge_watch(saved: object) -> dict:
    out = dict(DEFAULT_WATCH)
    if not isinstance(saved, dict):
        return out
    name = saved.get("folder_name")
    out["folder_name"] = str(name) if name else None
    out["enabled"] = bool(saved.get("enabled")) and bool(out["folder_name"])
    return out


def load_policy() -> dict:
    """defaults merged with saved overrides (unknown / invalid values ignored)."""
    cfg = defaults()
    if CONFIG_PATH.exists():
        try:
            saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            saved = {}
        for key in ("tolerance", "extractor", "today"):
            if saved.get(key) is not None:
                cfg[key] = saved[key]
        for code, outcome in (saved.get("reason_outcomes") or {}).items():
            if code in cfg["reason_outcomes"] and outcome in RESULTS:
                cfg["reason_outcomes"][code] = outcome
        cfg["file_types"] = _merge_file_types(saved.get("file_types"))
        cfg["watch"] = _merge_watch(saved.get("watch"))
    return cfg


def save_policy(data: dict) -> dict:
    """apply a partial update from the settings page and persist it."""
    cfg = load_policy()
    if data.get("tolerance") is not None:
        cfg["tolerance"] = str(data["tolerance"])
    if data.get("extractor"):
        cfg["extractor"] = data["extractor"]
    if "today" in data:
        cfg["today"] = data["today"] or None
    for code, outcome in (data.get("reason_outcomes") or {}).items():
        if code in cfg["reason_outcomes"] and outcome in RESULTS:
            cfg["reason_outcomes"][code] = outcome
    if "file_types" in data:
        cfg["file_types"] = _merge_file_types(data.get("file_types"))
    if "watch" in data:
        cfg["watch"] = _merge_watch(data.get("watch"))

    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps({k: cfg[k] for k in PERSIST_KEYS}, indent=2),
        encoding="utf-8",
    )
    return cfg


def as_ui() -> dict:
    """full payload for the settings page: current values + metadata."""
    return {**load_policy(), "reasons": REASONS, "results": RESULTS, "file_type_meta": FILE_TYPE_META}


def _main() -> int:
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "get"
    if cmd == "get":
        print(json.dumps(as_ui(), default=str))
    elif cmd == "set":
        data = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(save_policy(data), default=str))
    else:
        print(json.dumps({"error": f"unknown cmd {cmd}"}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
