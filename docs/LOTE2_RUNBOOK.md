# Runbook de lote 2

El soporte mantiene lote 1 y lote 2 aislados y ejecuta lote 2 aunque el material
de norma v4 todavía no exista. Comportamiento actual:

- **norma v4 sin regla oficial**: mientras no se publique el texto de
  `Norma_Pagos_v4`, `norma-v4` es un *alias explícito* de la lógica v3 (las
  decisiones se etiquetan `norma-v4` para la traza). No es un fallback silencioso;
  las versiones desconocidas (v5+) siguen fallando de forma cerrada.
- **texto de norma ausente**: si el Excel no trae la hoja `Norma_Pagos_v4`, se usa
  el texto de la hoja de norma más reciente disponible (v3) sólo como referencia y
  se registra un aviso; el lote NO se cae por esto.
- **proveedores y pedidos nuevos**: `proveedores_nuevos.csv` y `pedidos_nuevos.csv`
  se fusionan automáticamente sobre el maestro Excel cuando `--batch lote2`
  (incluye los proveedores extranjeros P012–P015 con NIF/IBAN no españoles).
- **formatos nuevos / multilingües**: si el parser digital no puede leer todos los
  campos obligatorios de un PDF con capa de texto, la factura se reprocesa con
  visión (Gemini). Un formato nuevo no requiere cambios de código.

## 1. Colocar el material oficial

Estructura esperada por defecto:

```text
lote_2_sorpresa/
├── facturas/                 # los PDF nuevos
├── erp_export_lote2.csv
├── proveedores_nuevos.csv    # se fusiona sobre el maestro (P012–P015)
├── pedidos_nuevos.csv        # se fusiona sobre el maestro
└── <excel-con-Norma_Pagos_v4>.xlsx   # opcional; si falta, se usa el texto v3
```

También se pueden indicar rutas distintas con `--dir`, `--xlsx` y `--erp-db`, y
fuentes adicionales con `--extra-suppliers` / `--extra-orders` (repetibles).

## 2. Actualizar el snapshot ERP

```bash
make -C challenge erp-lote2-fast
.venv/bin/python -m src.erp_snapshot
```

Comprobar que el ERP arrancó con `actualizacion_cargada=SI` antes de refrescar.
El snapshot hace *upsert*, por lo que actualiza asientos existentes sin duplicarlos.

## 3. Cuando llegue la norma v4 oficial

Mientras no llegue, lote 2 ya se ejecuta con la lógica v3 (alias). Cuando se
publique el texto real de `Norma_Pagos_v4`:

1. Leer `Norma_Pagos_v4` del Excel recibido.
2. Añadir un evaluador `_evaluate_v4` y registrarlo en `src/rules_engine.py`
   (sustituyendo el alias actual `"norma-v4": _evaluate_v3`).
3. Añadir tests por cada regla nueva o modificada.
4. Ejecutar toda la suite: `.venv/bin/python -m pytest -q`.

## 4. Ejecutar lote 2

```bash
.venv/bin/python -m src.pipeline \
  --batch lote2 \
  --replace-state
```

Con el Excel por defecto basta; los CSV de proveedores/pedidos nuevos se cargan
solos. Si se recibe un Excel con `Norma_Pagos_v4`, añadir `--xlsx <ruta>`.

La salida predeterminada es `outputs/outcomes_lote2.jsonl`. La escritura es
atómica y el pipeline valida cobertura exacta, duplicados y resultados permitidos.
`--replace-state` deja la consola mostrando el lote nuevo, mientras el historial
por ejecución conserva la traza completa del lote 1.

## 5. Validar los dos artefactos

```bash
.venv/bin/python -m src.deliverables \
  --dir challenge/facturas \
  --out outputs/outcomes.jsonl

.venv/bin/python -m src.deliverables \
  --dir lote_2_sorpresa/facturas \
  --out outputs/outcomes_lote2.jsonl
```

No copiar nada al repositorio público de entrega hasta que ambas validaciones
terminen con código 0.
