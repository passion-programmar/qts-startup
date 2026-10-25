import { LoadingIcon } from "@/app/components/loading-icon";

export default function Loading() {
  return (
    <div
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-surface px-4 text-slate-600"
      role="status"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-md">
        <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50">
          <LoadingIcon className="size-5 text-indigo-600" />
        </span>
        <span className="text-sm font-medium">Loading page…</span>
      </div>
    </div>
  );
}
