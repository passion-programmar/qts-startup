"use client";

import { FileSearch, X } from "lucide-react";
import { useMemo, useState } from "react";

export type ResponseDetailsCall = {
  summary: { label: string; value: string }[];
  reason: string;
  responseBody: string | null;
  responseTruncated: boolean;
  errorMessage: string | null;
};

type Field = { label: string; value: string; long?: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const show = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

function parseJson(text: string | null | undefined): unknown {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
}

// Splits a stored Google reply into labelled sections, so nothing has to be read from raw JSON.
function readSections(call: ResponseDetailsCall) {
  const body = parseJson(call.responseBody);
  const sections: { title: string; fields: Field[] }[] = [];
  if (!isRecord(body)) return { body, sections };

  if (isRecord(body.error)) {
    const error = body.error;
    sections.push({
      title: "Google error",
      fields: [
        { label: "Code", value: show(error.code ?? "—") },
        { label: "Status", value: show(error.status ?? "—") },
        { label: "Message", value: show(error.message ?? "—"), long: true },
        ...(error.details === undefined ? [] : [{ label: "Details", value: show(error.details), long: true }]),
      ],
    });
  }

  const candidate = Array.isArray(body.candidates) && isRecord(body.candidates[0]) ? body.candidates[0] : undefined;
  const usage = isRecord(body.usageMetadata) ? body.usageMetadata : undefined;
  const general: Field[] = [];
  if (typeof body.modelVersion === "string") general.push({ label: "Model", value: body.modelVersion });
  if (typeof body.responseId === "string") general.push({ label: "Response ID", value: body.responseId });
  if (typeof candidate?.finishReason === "string") general.push({ label: "Finish reason", value: candidate.finishReason });
  if (typeof candidate?.finishMessage === "string") general.push({ label: "Finish message", value: candidate.finishMessage, long: true });
  if (isRecord(body.promptFeedback)) general.push({ label: "Prompt feedback", value: show(body.promptFeedback), long: true });
  if (typeof body.totalTokens === "number") general.push({ label: "Total tokens", value: body.totalTokens.toLocaleString() });
  if (usage) {
    const tokenLabels: Record<string, string> = {
      promptTokenCount: "Prompt tokens",
      candidatesTokenCount: "Output tokens",
      thoughtsTokenCount: "Thinking tokens",
      cachedContentTokenCount: "Cached tokens",
      totalTokenCount: "Total tokens",
    };
    for (const [key, label] of Object.entries(tokenLabels)) {
      if (typeof usage[key] === "number") general.push({ label, value: (usage[key] as number).toLocaleString() });
    }
  }
  if (Array.isArray(candidate?.safetyRatings) && candidate.safetyRatings.length) {
    general.push({
      label: "Safety ratings",
      value: candidate.safetyRatings
        .filter(isRecord)
        .map((rating) => `${show(rating.category)}: ${show(rating.probability)}${rating.blocked ? " (blocked)" : ""}`)
        .join("\n"),
      long: true,
    });
  }
  if (general.length) sections.push({ title: "Google response", fields: general });

  const parts = isRecord(candidate?.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (text) {
    // Gemini usually answers with JSON; when it does, each top-level field gets its own row.
    const reply = parseJson(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    sections.push({
      title: "Gemini reply",
      fields: isRecord(reply)
        ? Object.entries(reply).map(([key, value]) => ({ label: key, value: show(value), long: true }))
        : [{ label: "Text", value: text, long: true }],
    });
  }
  return { body, sections };
}

export function ResponseDetailsButton({ call }: { call: ResponseDetailsCall }) {
  const [open, setOpen] = useState(false);
  const { body, sections } = useMemo(() => (open ? readSections(call) : { body: undefined, sections: [] }), [call, open]);
  const raw = body === undefined ? call.responseBody : JSON.stringify(body, null, 2);
  return (
    <>
      <button
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-slate-50"
        onClick={() => setOpen(true)}
        type="button"
      >
        <FileSearch aria-hidden="true" className="size-3.5" />
        View details
      </button>
      {open && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"
          onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
          onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
          role="dialog"
        >
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900">Google API request</h2>
                <p className="break-words text-xs text-slate-500">{call.reason}</p>
              </div>
              <button aria-label="Close" autoFocus className="flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100" onClick={() => setOpen(false)} type="button">
                <X className="size-4" />
              </button>
            </header>
            <div className="space-y-5 px-5 py-4">
              <FieldSection fields={call.summary} title="Request" />
              {call.errorMessage ? (
                <FieldSection fields={[{ label: "Error", value: call.errorMessage, long: true }]} title="Network error" />
              ) : null}
              {sections.map((section) => (
                <FieldSection fields={section.fields} key={section.title} title={section.title} />
              ))}
              {call.responseTruncated ? (
                <p className="text-xs text-amber-700">Response was truncated after 1 MB, so some fields may be missing.</p>
              ) : null}
              {raw ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-indigo-700">Raw response JSON</summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
                    {raw}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FieldSection({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {fields.map((field, index) => (
          <div className="grid gap-1 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3" key={`${field.label}-${index}`}>
            <dt className="break-words text-xs font-medium text-slate-600">{field.label}</dt>
            <dd
              className={`whitespace-pre-wrap break-words text-xs text-slate-900 ${
                field.long ? "max-h-72 overflow-y-auto" : ""
              }`}
            >
              {field.value || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
