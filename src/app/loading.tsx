import { LoadingIcon } from "@/app/components/loading-icon";

export default function Loading() {
  return (
    <div
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-[#f8f9fa] text-slate-600"
      role="status"
    >
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <LoadingIcon className="size-5 text-indigo-600" />
        <span className="text-sm font-medium">Loading page…</span>
      </div>
    </div>
  );
}
