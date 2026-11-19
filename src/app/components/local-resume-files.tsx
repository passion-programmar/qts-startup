"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Notice } from "@/app/ui/feedback";

// Removing a job also deletes its résumé and cover-letter PDFs from this PC. The page hands their
// Downloads/QTS_Resume paths to the QTS extension (its bridge on this site), which deletes them
// through the Apply PDFs folder it may read and write, whichever Chrome downloaded them. The result
// shows in a small notice in the corner, since the removed row is already gone.

type DeleteAnswer = { ok: boolean; deleted?: number; missing?: number; needsAccess?: boolean; error?: string };
type LocalFilesMessage = { tone: "success" | "warning" | "info"; text: string };

const EVENT = "qts-local-resume-files";

function askExtension(files: string[]): Promise<DeleteAnswer> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const done = (answer: DeleteAnswer) => {
      window.removeEventListener("message", listen);
      clearTimeout(timer);
      resolve(answer);
    };
    const listen = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== "qts-extension" || event.data.requestId !== requestId) return;
      const data = event.data;
      done({
        ok: data.ok === true,
        deleted: Number(data.deleted) || 0,
        missing: Number(data.missing) || 0,
        needsAccess: data.needsAccess === true,
        error: typeof data.error === "string" ? data.error : undefined,
      });
    };
    const timer = setTimeout(() => done({ ok: false }), 15000);
    window.addEventListener("message", listen);
    window.postMessage({ source: "qts-app", type: "delete-resume-files", requestId, files }, window.location.origin);
  });
}

function describe(answer: DeleteAnswer): LocalFilesMessage {
  const files = (count: number) => `${count} résumé ${count === 1 ? "file" : "files"}`;
  if (answer.ok) {
    if (answer.deleted) return { tone: "success", text: `Deleted ${files(answer.deleted)} from this PC.` };
    return { tone: "info", text: "The résumé files were already gone from this PC." };
  }
  if (answer.needsAccess) {
    return { tone: "warning", text: "Résumé files were not deleted from this PC: in the QTS extension, open Apply PDFs folder and allow read and write access to QTS_Resume." };
  }
  if (answer.error) return { tone: "warning", text: `Résumé files were not deleted from this PC: ${answer.error}` };
  return { tone: "warning", text: "Résumé files were not deleted from this PC: open this page in a Chrome with the QTS extension." };
}

/** Deletes a removed job's PDFs on this PC (nothing when there are none) and reports in the corner notice. */
export function deleteLocalResumeFiles(files: string[] | undefined) {
  if (!files?.length) return;
  askExtension(files).then((answer) => {
    window.dispatchEvent(new CustomEvent<LocalFilesMessage>(EVENT, { detail: describe(answer) }));
  }).catch(() => {});
}

/** Runs deleteLocalResumeFiles once for each new delete result of a form. */
export function useDeleteLocalResumeFiles(state: { resumeFiles?: string[] }) {
  useEffect(() => {
    deleteLocalResumeFiles(state.resumeFiles);
  }, [state]);
}

/** The corner notice for deleted résumé files; put once on a page that removes jobs. */
export function LocalResumeFilesNotice() {
  const [message, setMessage] = useState<LocalFilesMessage | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<LocalFilesMessage>).detail;
      setMessage(detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), detail.tone === "warning" ? 12000 : 6000);
    };
    window.addEventListener(EVENT, show);
    return () => {
      window.removeEventListener(EVENT, show);
      clearTimeout(timer);
    };
  }, []);

  if (!message) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] shadow-lg">
      <Notice className="pr-9" tone={message.tone}>{message.text}</Notice>
      <button
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded p-1 text-fg-muted hover:bg-black/5 hover:text-fg"
        onClick={() => setMessage(null)}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
