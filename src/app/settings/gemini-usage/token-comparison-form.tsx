"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/app/components/loading-icon";

type ComparisonResult = {
  localEstimate: number;
  googleCount: number;
  difference: number;
  differencePercent: number;
  safe: boolean;
  imageEstimate: number | null;
  imageSize: string | null;
  keyNumber: number;
  keyHashPrefix: string;
};

type SelectedImage = {
  name: string;
  previewUrl: string;
  mimeType: string;
  data: string;
  width: number | null;
  height: number | null;
};

// Gemini accepts these image types; the server keeps requests under Vercel's body limit.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

// Pixel size for the local estimate; formats the browser cannot decode (HEIC) give null.
function readImageSize(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = url;
  });
}

export function TokenComparisonForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function clearImage() {
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    if (!IMAGE_TYPES.includes(file.type)) {
      setError("Choose a PNG, JPEG, WebP, HEIC, or HEIF image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Choose an image of 3 MB or less.");
      return;
    }
    try {
      const previewUrl = URL.createObjectURL(file);
      const [data, size] = await Promise.all([readAsBase64(file), readImageSize(previewUrl)]);
      clearImage();
      setImage({ name: file.name, previewUrl, mimeType: file.type, data, ...size });
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "The image could not be read.");
    }
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/gemini-token-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ...(image
            ? { image: { mimeType: image.mimeType, data: image.data, width: image.width, height: image.height } }
            : {}),
        }),
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
          Gemini token calibration
        </div>
        <h2 className="mt-1 text-lg font-bold text-slate-900">
          Compare local estimate with Google
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste a prompt, choose an image, or both, to compare the server
          estimate with Google. This manual test sends one CountTokens
          request, does not generate content, and does not save the prompt
          or the image.
        </p>
      </div>

      <form className="space-y-3" onSubmit={compare}>
        <label className="block text-sm font-semibold text-slate-800" htmlFor="token-test-prompt">
          Prompt <span className="font-normal text-slate-500">(optional with an image)</span>
        </label>
        <textarea
          className="min-h-40 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          id="token-test-prompt"
          maxLength={750_000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Paste a representative Gemini prompt here"
          value={prompt}
        />
        <div>
          <span className="block text-sm font-semibold text-slate-800">
            Image <span className="font-normal text-slate-500">(optional · PNG, JPEG, WebP, HEIC, HEIF · up to 3 MB)</span>
          </span>
          {image ? (
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-amber-300 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
              <img alt="" className="size-16 rounded-lg object-cover" src={image.previewUrl} />
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-semibold text-slate-800">{image.name}</div>
                <div className="mt-0.5 text-slate-500">
                  {image.width && image.height
                    ? `${image.width} × ${image.height} px`
                    : "Size unknown in this browser; the local estimate assumes one 258-token unit"}
                </div>
              </div>
              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={clearImage}
                type="button"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="mt-2 inline-flex cursor-pointer items-center rounded-lg border border-dashed border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100/60">
              Choose image…
              <input accept={IMAGE_TYPES.join(",")} className="sr-only" onChange={chooseImage} type="file" />
            </label>
          )}
        </div>
        <button
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting || (prompt.trim().length === 0 && !image)}
          type="submit"
        >
          {submitting && <LoadingIcon className="mr-2 inline-block size-4 align-[-3px]" />}
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
      {result.imageEstimate !== null ? (
        <Metric
          label={`Image part of local estimate${result.imageSize ? ` (${result.imageSize})` : ""}`}
          value={result.imageEstimate.toLocaleString()}
        />
      ) : null}
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
    (value.imageEstimate === null || typeof value.imageEstimate === "number") &&
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
