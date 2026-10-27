"use client";

import { Copy, FolderOpen } from "lucide-react";
import { useState } from "react";

// A résumé folder that opens in Windows Explorer: the QTS extension in this Chrome finds the résumé
// it downloaded there and shows it. In a Chrome that did not save it, the page says which one did
// and offers to copy the path.
export function OpenFolderButton({ folder, savedOn }: { folder: string; savedOn: string | null }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const display = `Downloads\\${folder.replace(/\//g, "\\").replace(/\\+$/, "")}`;

  async function open() {
    setPending(true);
    setMessage(null);
    const result = await askExtension(folder);
    setPending(false);
    if (result.ok) return;
    setMessage(result.notHere
      ? `Saved ${savedOn ? `on ${savedOn}` : "by another Chrome"}; open it there, or copy the path.`
      : result.error || "Open this page in a Chrome with the QTS extension.");
  }

  async function copy() {
    await navigator.clipboard.writeText(display).catch(() => {});
    setMessage("Path copied.");
  }

  return (
    <div className="min-w-0 text-xs">
      <button
        className="inline-flex max-w-full items-start gap-1 text-left text-blue-700 hover:underline disabled:opacity-60"
        disabled={pending}
        onClick={open}
        title="Open in Windows Explorer"
        type="button"
      >
        <FolderOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-all">{display}</span>
      </button>
      {savedOn && <span className="mt-0.5 block text-[10px] text-slate-500">Saved on {savedOn}</span>}
      {message && (
        <span className="mt-1 flex items-start gap-1 text-[10px] text-amber-700" role="status">
          {message}
          <button aria-label="Copy folder path" className="shrink-0 text-slate-500 hover:text-slate-800" onClick={copy} type="button">
            <Copy className="size-3" />
          </button>
        </span>
      )}
    </div>
  );
}

type ExtensionAnswer = { ok: boolean; notHere?: boolean; error?: string };

/** Asks the QTS extension (through its bridge on this site) to open a folder; times out without one. */
function askExtension(folder: string): Promise<ExtensionAnswer> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const done = (answer: ExtensionAnswer) => {
      window.removeEventListener("message", listen);
      clearTimeout(timer);
      resolve(answer);
    };
    const listen = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== "qts-extension" || event.data.requestId !== requestId) return;
      done({ ok: event.data.ok === true, notHere: event.data.notHere === true, error: event.data.error });
    };
    const timer = setTimeout(() => done({ ok: false, error: "The QTS extension did not answer. Open this page in a Chrome with the extension." }), 4000);
    window.addEventListener("message", listen);
    window.postMessage({ source: "qts-app", type: "open-resume-folder", requestId, folder }, window.location.origin);
  });
}
