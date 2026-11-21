"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** A command or text block with a Copy button that says "Copied" for a moment. */
export function CopyCommand({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1500);
  }
  return (
    <div className="group relative min-w-0">
      {label ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{label}</p> : null}
      {/* Fixed colours (not the theme's slate scale, which dark mode flips): a dark block in both themes. */}
      <pre className="overflow-x-auto rounded-lg border border-[#1e293b] bg-[#0b1220] py-2.5 pl-3 pr-20 font-mono text-[12.5px] leading-5 text-[#e2e8f0]">{text}</pre>
      <button
        aria-label={`Copy: ${text.split("\n")[0]}`}
        className={`absolute right-2 ${label ? "top-7" : "top-2"} inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold ${state === "copied" ? "border-[#10b981] bg-[#059669] text-white" : "border-[#475569] bg-[#1e293b] text-[#f1f5f9] hover:bg-[#334155]"}`}
        onClick={copy}
        type="button"
      >
        {state === "copied" ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
        {state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy"}
      </button>
    </div>
  );
}
