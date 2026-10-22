"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ComparisonResult = {
  localEstimate: number;
  googleCount: number;
  difference: number;
  differencePercent: number;
  safe: boolean;
  keyNumber: number;
  keyHashPrefix: string;
};

export function TokenComparisonForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/gemini-token-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data: unknown = await response.json();
      if (!response.ok || !isComparisonResult(data)) {
        throw new Error(readError(data) || "Token comparison failed.");
      }
      setResult(data);
      router.refresh();
    } catch (comparisonError) {
      setError(
        comparisonError instanceof Error
          ? comparisonError.message
          : "Token comparison failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="mb-4">
        <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
          Temporary Vercel Production test
        </div>
        <h2 className="mt-1 text-lg font-bold text-slate-900">
          Compare local estimate with Google
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste the exact prompt to test. This sends one CountTokens request from
          Vercel Production and does not generate content or save the prompt.
        </p>
      </div>

      <form className="space-y-3" onSubmit={compare}>
        <label className="block text-sm font-semibold text-slate-800" htmlFor="token-test-prompt">
          Prompt
        </label>
        <textarea
          className="min-h-40 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          id="token-test-prompt"
          maxLength={750_000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Paste a representative Gemini prompt here"
          required
          value={prompt}
        />
        <button
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting || prompt.trim().length === 0}
          type="submit"
        >
          {submitting ? "Comparing..." : "Compare token counts"}
        </button>
      </form>

      {error ? (
        <div className="mt-4 rounded-lg bg-rose-100 px-3 py-2 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      {result ? <ComparisonResultView result={result} /> : null}
    </section>
  );
}

function ComparisonResultView({ result }: { result: ComparisonResult }) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Metric label="API key" value={`Key ${result.keyNumber} · ${result.keyHashPrefix}`} />
      <Metric label="Local estimate" value={result.localEstimate.toLocaleString()} />
      <Metric label="Google count" value={result.googleCount.toLocaleString()} />
      <Metric label="Difference" value={formatSigned(result.difference)} />
      <Metric label="Difference %" value={`${formatSigned(result.differencePercent)}%`} />
      <Metric label="Result" value={result.safe ? "Safe" : "Underestimated"} warning={!result.safe} />
    </div>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${warning ? "border-rose-300" : "border-amber-200"}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${warning ? "text-rose-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

function isComparisonResult(value: unknown): value is ComparisonResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.localEstimate === "number" &&
    typeof value.googleCount === "number" &&
    typeof value.difference === "number" &&
    typeof value.differencePercent === "number" &&
    typeof value.safe === "boolean" &&
    typeof value.keyNumber === "number" &&
    typeof value.keyHashPrefix === "string"
  );
}

function readError(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
