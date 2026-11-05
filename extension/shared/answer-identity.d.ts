export type AnswerIdentity = { version: 1; key: string; valueType: string };
declare const api: {
  version: number;
  identity(question: string): AnswerIdentity | null;
  same(left: string, right: string): boolean;
  duplicateGroups<T extends {questionText: string; managerId?: string; contextKey?: string; scope?: string; candidateId?: string | null; jobId?: string | null}>(rows: T[]): T[][];
  variantKey(variant: {questionText?: string; kind: string; options: string[]; representation?: unknown; policyContext?: string}): string;
};
export default api;
