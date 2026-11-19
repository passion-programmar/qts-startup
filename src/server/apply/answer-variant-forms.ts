import type { AnswerVariant } from "./manager-answer-values";

// The Manager's own edits of a saved answer's "other forms" (kind "alternative": "30 days" for
// "1 month") and "per job site" forms (entries with a site, e.g. what boards.greenhouse.io/akamai
// took). Pure functions over the row's variants array: every other variant is kept as it is.
// The extension may wrap an entry ({ kind: "normal-variation", normalVariation: <real entry> });
// the real entry is always read through unwrapVariant, and a wrapped entry stays wrapped.

export const MAX_ALTERNATIVES = 20;
export const MAX_FORM_LENGTH = 500;

type Result = { ok: true; variants: AnswerVariant[] } | { ok: false; reason: string };

export function unwrapVariant(entry: AnswerVariant): AnswerVariant {
  return entry.normalVariation && typeof entry.normalVariation === "object" ? entry.normalVariation : entry;
}

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const same = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();
const isSiteForm = (entry: AnswerVariant) => typeof unwrapVariant(entry).site === "string" && Boolean(unwrapVariant(entry).site);
const isAlternative = (entry: AnswerVariant) => unwrapVariant(entry).kind === "alternative" && !isSiteForm(entry);

/** The other forms of the answer, once each, in saved order. */
export function alternativesOf(variants: AnswerVariant[]): string[] {
  const seen = new Set<string>();
  return variants.filter(isAlternative).map((entry) => clean(unwrapVariant(entry).answer))
    .filter((text) => text && !seen.has(text.toLowerCase()) && seen.add(text.toLowerCase()));
}

/** What each job site took: one line per site and box kind. */
export function siteFormsOf(variants: AnswerVariant[]): { site: string; kind: string; answer: string }[] {
  return variants.filter(isSiteForm).map((entry) => {
    const real = unwrapVariant(entry);
    return { site: real.site as string, kind: real.kind, answer: real.answer };
  });
}

function validText(value: unknown): string | null {
  const text = clean(value);
  return text && text.length <= MAX_FORM_LENGTH ? text : null;
}

export function addAlternative(variants: AnswerVariant[], value: unknown, mainAnswer = ""): Result {
  const text = validText(value);
  if (!text) return { ok: false, reason: `Write the other form (1–${MAX_FORM_LENGTH} characters).` };
  const current = alternativesOf(variants);
  if (same(text, mainAnswer) || current.some((other) => same(other, text))) return { ok: false, reason: "This form is already saved." };
  if (current.length >= MAX_ALTERNATIVES) return { ok: false, reason: `At most ${MAX_ALTERNATIVES} other forms. Remove one first.` };
  return { ok: true, variants: [...variants, { kind: "alternative", options: [], answer: text }] };
}

export function removeAlternative(variants: AnswerVariant[], value: unknown): Result {
  const text = clean(value);
  const kept = variants.filter((entry) => !(isAlternative(entry) && same(unwrapVariant(entry).answer, text)));
  return kept.length === variants.length ? { ok: false, reason: "This form was already removed. Reload Profile." } : { ok: true, variants: kept };
}

const siteMatch = (entry: AnswerVariant, site: string, kind: string) => {
  const real = unwrapVariant(entry);
  return isSiteForm(entry) && same(real.site as string, site) && real.kind === kind;
};

export function editSiteForm(variants: AnswerVariant[], site: unknown, kind: unknown, value: unknown): Result {
  const text = validText(value);
  if (!text) return { ok: false, reason: `Write the answer for this site (1–${MAX_FORM_LENGTH} characters).` };
  if (typeof site !== "string" || typeof kind !== "string" || !site.trim()) return { ok: false, reason: "Choose a site form to change." };
  let found = false;
  const next = variants.map((entry) => {
    if (!siteMatch(entry, site, kind)) return entry;
    found = true;
    return entry.normalVariation && typeof entry.normalVariation === "object"
      ? { ...entry, normalVariation: { ...entry.normalVariation, answer: text } }
      : { ...entry, answer: text };
  });
  return found ? { ok: true, variants: next } : { ok: false, reason: "This site form was removed. Reload Profile." };
}

export function deleteSiteForm(variants: AnswerVariant[], site: unknown, kind: unknown): Result {
  if (typeof site !== "string" || typeof kind !== "string" || !site.trim()) return { ok: false, reason: "Choose a site form to delete." };
  const kept = variants.filter((entry) => !siteMatch(entry, site, kind));
  return kept.length === variants.length ? { ok: false, reason: "This site form was already removed. Reload Profile." } : { ok: true, variants: kept };
}
