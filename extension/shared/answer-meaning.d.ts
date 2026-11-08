export type MeaningTopic = { id: string; title: string };
export type Meaning = { topic: string | null; title: string | null; key: string | null; negated: boolean; otherPerson: boolean; words: string[] };
export type SavedRow = { id?: string; scope?: string; questionText: string; answer: string; variants?: { questionText?: string }[] };
declare const api: {
  version: number;
  TOPICS: readonly MeaningTopic[];
  clean(text: unknown): string;
  topicOf(text: string): (MeaningTopic & { test: RegExp }) | null;
  meaningOf(text: string): Meaning;
  asksYesNo(question: string, options?: string[]): boolean;
  matchSaved<T extends SavedRow>(question: string, rows: T[], field?: { kind?: string; options?: string[] }): { row: T; confidence: "high" | "medium"; why: string } | null;
  parseLanguageLevels(text: unknown): Record<string, number>;
  languageAnswer(field: { label: string; kind: string; options?: string[] }, levelsOf: () => Record<string, number>): { value: string | boolean; reason: string } | null;
  levelRank(text: string): number | null;
  employerAnswer(field: { label: string; kind: string; options?: string[] }, experiences: { companyName?: string | null; isCurrent?: boolean | null; endDate?: string | null }[], jobCompany?: string): { value: string | boolean; reason: string } | null;
  companyKey(name: string): string;
};
export default api;
