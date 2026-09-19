# Runbook de lote 2

El soporte queda preparado para mantener lote 1 y lote 2 aislados. La norma v4
falla de forma cerrada hasta que su material oficial llegue y exista un evaluador
explícito; nunca se reutiliza v3 silenciosamente.

## 1. Colocar el material oficial

Estructura esperada por defecto:

```text
lote_2_sorpresa/
├── facturas/                 # los 40 PDF nuevos
├── erp_export_lote2.csv
└── <excel-con-Norma_Pagos_v4>.xlsx
```

También se pueden indicar rutas distintas con `--dir`, `--xlsx` y `--erp-db`.

## 2. Actualizar el snapshot ERP

```bash
make -C challenge erp-lote2-fast
.venv/bin/python -m src.erp_snapshot
```

Comprobar que el ERP arrancó con `actualizacion_cargada=SI` antes de refrescar.
El snapshot hace *upsert*, por lo que actualiza asientos existentes sin duplicarlos.

## 3. Implementar y probar norma v4

1. Leer `Norma_Pagos_v4` del Excel recibido.
2. Añadir un evaluador `_evaluate_v4` y registrarlo en `src/rules_engine.py`.
3. Añadir tests por cada regla nueva o modificada.
4. Ejecutar toda la suite: `.venv/bin/python -m pytest -q`.

Hasta completar estos pasos, `--batch lote2` termina con error en vez de producir
resultados bajo reglas incorrectas.

## 4. Ejecutar lote 2

```bash
.venv/bin/python -m src.pipeline \
  --batch lote2 \
  --xlsx lote_2_sorpresa/<excel-con-Norma_Pagos_v4>.xlsx
```

La salida predeterminada es `outputs/outcomes_lote2.jsonl`. La escritura es
atómica y el pipeline valida cobertura exacta, duplicados y resultados permitidos.

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
