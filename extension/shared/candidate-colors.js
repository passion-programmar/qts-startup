/** Curated palette for candidate name colors — keep in sync with shared/candidate-colors.ts */
const CANDIDATE_COLOR_VALUES = [
  '#2563EB',
  '#4F46E5',
  '#7C3AED',
  '#9333EA',
  '#DB2777',
  '#E11D48',
  '#DC2626',
  '#EA580C',
  '#D97706',
  '#CA8A04',
  '#16A34A',
  '#059669',
  '#0F766E',
  '#0891B2',
];

function isCandidateColor(color) {
  if (!color) return false;
  return CANDIDATE_COLOR_VALUES.some((c) => c.toLowerCase() === color.toLowerCase());
}

function normalizeCandidateColor(color, fallbackIndex = 0) {
  if (isCandidateColor(color)) {
    return CANDIDATE_COLOR_VALUES.find((c) => c.toLowerCase() === color.toLowerCase());
  }
  const index = Math.abs(fallbackIndex) % CANDIDATE_COLOR_VALUES.length;
  return CANDIDATE_COLOR_VALUES[index];
}
