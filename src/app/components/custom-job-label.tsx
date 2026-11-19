import { Badge } from "@/app/ui/badge";

// A pasted (launcher "Custom") job or bid: a badge for its kind beside the title, and its note under it.

export function CustomKindBadge({ kind }: { kind: string | null }) {
  if (kind === "easy_apply") return <Badge className="ml-1.5 align-middle" tone="primary">Easy Apply</Badge>;
  if (kind === "recruiter") return <Badge className="ml-1.5 align-middle" tone="warning">Recruiter</Badge>;
  return null;
}

export function CustomNote({ note }: { note: string | null }) {
  const text = note?.trim();
  if (!text) return null;
  return <span className="mt-1 block truncate text-[11px] text-slate-500" title={text}>{text}</span>;
}
