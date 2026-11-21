// Calendar colours by category: strong backgrounds with white text, written as fixed colours so the
// dark theme cannot wash them out. AI/ML is always red and DevOps always blue; every other category
// takes the next colour of the list in name order, so each one keeps its own colour.

export type CategoryColor = { background: string; text: string };

const RED = "#dc2626";
const BLUE = "#2563eb";
const NONE = "#475569";

// The other categories' colours (no red or blue, so those stay AI/ML and DevOps only).
const palette = ["#16a34a", "#ea580c", "#9333ea", "#0d9488", "#db2777", "#b45309", "#4f46e5", "#0891b2", "#65a30d", "#be123c", "#7c3aed", "#0f766e"];

function fixedColor(name: string): string | null {
  const plain = name.toLowerCase();
  if (/\bai\b|\bml\b|machine learning|artificial intelligence/.test(plain)) return RED;
  if (/dev\s*ops/.test(plain)) return BLUE;
  return null;
}

/** Each category's colour; categories are the full list, so the colours do not change between pages. */
export function categoryColors(categories: string[]): Map<string, CategoryColor> {
  const colors = new Map<string, CategoryColor>();
  let next = 0;
  for (const name of [...categories].sort((a, b) => a.localeCompare(b))) {
    const fixed = fixedColor(name);
    colors.set(name, { background: fixed ?? palette[next++ % palette.length] ?? NONE, text: "#ffffff" });
  }
  return colors;
}

/** A round's colour: its category's, a fixed one for AI/ML or DevOps names not in the list, else grey. */
export function colorOf(colors: Map<string, CategoryColor>, category: string | null): CategoryColor {
  if (!category) return { background: NONE, text: "#ffffff" };
  return colors.get(category) ?? { background: fixedColor(category) ?? NONE, text: "#ffffff" };
}
