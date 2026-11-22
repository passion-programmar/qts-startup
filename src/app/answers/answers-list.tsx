"use client";

import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { deleteAnswerAction, saveAnswerAction } from "@/app/answers/actions";
import { Button } from "@/app/ui/button";
import { ConfirmDialog } from "@/app/ui/confirm-dialog";

export type AnswerRow = { id: string; version: string; question: string; answers: string[] };

// Questions sites ask most, offered while a new question is typed (only those not in the list yet).
const COMMON_QUESTIONS = [
  "How did you hear about us?", "Will you now or in the future require visa sponsorship?",
  "Are you legally authorized to work in this country?", "Notice period", "When can you start?",
  "Salary expectations", "Language levels", "Are you willing to work remotely?",
  "Are you willing to work hybrid or in the office?", "Are you open to relocation?", "Are you willing to travel?",
  "Preferred contract type (B2B or employment)", "Full-time or part-time?", "Are you subject to a non-compete agreement?",
  "Do you have relatives working at the company?", "Do you consent to us keeping your data for future job opportunities?",
];

const inputClass = "h-9 w-full rounded-control border border-line bg-card px-3 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/** Answers as chips: type and press Enter (or a comma) to add one; ✕ or Backspace removes. */
function AnswerChips({ answers, onChange, draft, onDraft, label }: {
  answers: string[]; onChange: (next: string[]) => void; draft: string; onDraft: (text: string) => void; label: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const add = () => {
    const text = draft.replace(/\s+/g, " ").trim();
    if (text && !answers.some((answer) => answer.toLowerCase() === text.toLowerCase())) onChange([...answers, text]);
    onDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); }
    else if (event.key === "Backspace" && !draft && answers.length) onChange(answers.slice(0, -1));
  };
  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-control border border-line bg-card px-2 py-1 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary" onClick={() => input.current?.focus()}>
      {answers.map((answer, index) => (
        <span className={`inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-medium ring-1 ring-inset ${index === 0 ? "bg-primary-soft text-primary-text ring-primary-ring" : "bg-subtle text-fg-soft ring-line"}`} key={answer} title={index === 0 ? "Main answer (text boxes get this one)" : "Another answer (tried when the main one is not a choice)"}>
          <span className="truncate">{answer}</span>
          <button aria-label={`Remove ${answer}`} className="rounded-full p-0.5 text-fg-faint hover:bg-line hover:text-danger-text" onClick={(event) => { event.stopPropagation(); onChange(answers.filter((other) => other !== answer)); }} type="button">
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <input aria-label={label} className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-fg outline-none focus-visible:outline-none placeholder:text-fg-faint" onBlur={add} onChange={(event) => onDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={answers.length ? "Another answer… (Enter)" : "Answer… (Enter to add more)"} ref={input} value={draft} />
    </div>
  );
}

/** The new question, or one being edited: question + its answers, saved together. */
function QuestionEditor({ row, suggestions, onDone }: { row?: AnswerRow; suggestions: string[]; onDone?: () => void }) {
  const [question, setQuestion] = useState(row?.question ?? "");
  const [answers, setAnswers] = useState<string[]>(row?.answers ?? []);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const save = () => {
    const typed = draft.replace(/\s+/g, " ").trim();
    const all = typed && !answers.some((answer) => answer.toLowerCase() === typed.toLowerCase()) ? [...answers, typed] : answers;
    if (!question.trim()) { setMessage("Write the question."); return; }
    if (!all.length) { setMessage("Write at least one answer."); return; }
    startTransition(async () => {
      const result = await saveAnswerAction({ ...(row ? { id: row.id, version: row.version } : {}), question, answers: all });
      if (!result.ok) { setMessage(result.message); return; }
      setMessage("");
      if (row) onDone?.();
      else { setQuestion(""); setAnswers([]); setDraft(""); }
    });
  };
  const listId = row ? undefined : "answers-common-questions";
  return (
    <div className="space-y-1.5">
      <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] md:items-start">
        <input aria-label="Question" className={inputClass} list={listId} maxLength={300} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }} placeholder="Question…" value={question} />
        <AnswerChips answers={answers} draft={draft} label="Answers" onChange={setAnswers} onDraft={setDraft} />
        <div className="flex gap-1.5">
          <Button icon={row ? <Check aria-hidden="true" className="size-3.5" /> : <Plus aria-hidden="true" className="size-3.5" />} loading={pending} onClick={save} size="sm" type="button">{row ? "Save" : "Add"}</Button>
          {row && <Button onClick={onDone} size="sm" type="button" variant="secondary">Cancel</Button>}
        </div>
      </div>
      {listId && <datalist id={listId}>{suggestions.map((text) => <option key={text} value={text} />)}</datalist>}
      {message && <p className="text-xs text-danger-text" role="alert">{message}</p>}
    </div>
  );
}

function QuestionRow({ row }: { row: AnswerRow }) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  if (editing) return <li className="bg-primary-soft/40 px-4 py-2.5"><QuestionEditor onDone={() => setEditing(false)} row={row} suggestions={[]} /></li>;
  return (
    <li className="group grid gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] md:items-center">
      <p className="text-sm font-medium text-fg">{row.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {row.answers.map((answer, index) => (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${index === 0 ? "bg-primary-soft text-primary-text ring-primary-ring" : "bg-subtle text-fg-soft ring-line"}`} key={answer} title={index === 0 ? "Main answer" : "Another answer"}>{answer}</span>
        ))}
      </div>
      <div className="flex items-center gap-1 md:opacity-60 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <Button aria-label={`Edit ${row.question}`} icon={<Pencil aria-hidden="true" className="size-3.5" />} onClick={() => setEditing(true)} size="sm" type="button" variant="ghost" />
        <ConfirmDialog
          confirmLabel="Delete"
          description={<>“{row.question}” and its {row.answers.length === 1 ? "answer" : `${row.answers.length} answers`} will no longer be filled in.</>}
          disabled={pending}
          onConfirm={() => startTransition(async () => {
            const result = await deleteAnswerAction({ id: row.id, version: row.version });
            setMessage(result.ok ? "" : result.message);
          })}
          title="Delete this question?"
          trigger={null}
          triggerIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
          triggerLabel={`Delete ${row.question}`}
          triggerVariant="ghost"
        />
      </div>
      {message && <p className="text-xs text-danger-text md:col-span-3" role="alert">{message}</p>}
    </li>
  );
}

// The Answers page: one compact line per question, its answers as chips (the first is the main one).
export function AnswersList({ rows }: { rows: AnswerRow[] }) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...rows]
      .filter((row) => !needle || `${row.question} ${row.answers.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => a.question.localeCompare(b.question));
  }, [rows, search]);
  const asked = new Set(rows.map((row) => row.question.toLowerCase()));
  const suggestions = COMMON_QUESTIONS.filter((question) => !asked.has(question.toLowerCase()));

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <div className="border-b border-line bg-subtle/60 px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">New question</p>
        <QuestionEditor suggestions={suggestions} />
      </div>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2">
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-faint" />
        <input aria-label="Search questions and answers" className="h-8 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint" onChange={(event) => setSearch(event.target.value)} placeholder="Search questions and answers…" value={search} />
        <span className="shrink-0 text-xs text-fg-muted">{search.trim() ? `${shown.length} of ${rows.length}` : rows.length} {rows.length === 1 ? "question" : "questions"}</span>
      </div>
      {shown.length ? (
        <ul className="divide-y divide-line-soft">{shown.map((row) => <QuestionRow key={`${row.id}-${row.version}`} row={row} />)}</ul>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-fg-muted">{rows.length ? "No question matches your search." : "No answers yet. Add your first question above."}</p>
      )}
    </div>
  );
}
