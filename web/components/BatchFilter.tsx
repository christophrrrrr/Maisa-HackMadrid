"use client";

import { usePathname, useRouter } from "next/navigation";

type BatchOption = {
  runId: string;
  label: string;
};

export default function BatchFilter({
  value,
  options,
}: {
  value: string;
  options: BatchOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();

  function selectBatch(runId: string) {
    router.push(runId === "all" ? pathname : `${pathname}?run=${encodeURIComponent(runId)}`);
  }

  return (
    <label className="an-filter">
      <span>Datos</span>
      <select
        className="field"
        value={value}
        onChange={(event) => selectBatch(event.target.value)}
        aria-label="Seleccionar lote"
      >
        <option value="all">Todos los lotes</option>
        {options.map((option) => (
          <option value={option.runId} key={option.runId}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
