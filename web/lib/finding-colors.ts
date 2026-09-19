export const FINDING_COLORS = [
  "#155eef",
  "#c4320a",
  "#16815d",
  "#7a5af8",
  "#dc6803",
  "#088ab2",
  "#c11574",
  "#475467",
  "#039855",
  "#b54708",
] as const;

const FINDING_COLOR_INDEX: Record<string, number> = {
  iban_mismatch: 0,
  already_paid: 1,
};

export function findingColor(code: string): string {
  const fixedIndex = FINDING_COLOR_INDEX[code];
  if (fixedIndex !== undefined) return FINDING_COLORS[fixedIndex];

  let hash = 0;
  for (let index = 0; index < code.length; index += 1) {
    hash = (hash * 31 + code.charCodeAt(index)) >>> 0;
  }
  return FINDING_COLORS[hash % FINDING_COLORS.length];
}

export function findingBadgeStyle(code: string) {
  const color = findingColor(code);
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: `${color}14`,
  };
}
