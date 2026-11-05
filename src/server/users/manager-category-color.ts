export const managerCategoryColors = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#10b981" },
  { name: "Blue", value: "#2563eb" },
  { name: "Pink", value: "#ec4899" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Indigo", value: "#4f46e5" },
  { name: "Violet", value: "#a855f7" },
  { name: "Brown", value: "#9a5b32" },
  { name: "Gray", value: "#64748b" },
  { name: "Navy", value: "#0f172a" },
  { name: "White", value: "#ffffff" },
  { name: "Lemon", value: "#fef08a" },
] as const;

const managerCategoryColorValues = new Set<string>(
  managerCategoryColors.map(({ value }) => value),
);

export function isManagerCategoryColor(value: string): boolean {
  return value === "" || managerCategoryColorValues.has(value);
}

export function labelTextColor(background: string | null): string {
  if (!background || !/^#[0-9a-f]{6}$/i.test(background)) return "#000000";
  const rgb = [1, 3, 5].map(offset => {
    const channel = parseInt(background.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179 ? "#000000" : "#ffffff";
}
