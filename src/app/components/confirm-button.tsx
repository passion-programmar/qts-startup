"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// One confirmation for every delete or stop in the app: a button that first asks, in an in-app
// dialog naming what happens, then submits its form (or runs onConfirm). Cancel has the focus and
// Escape cancels, so nothing is lost by a stray click or key.
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  children,
  className,
  ariaLabel,
  disabled = false,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  // Without it, confirming submits the form the button sits in.
  onConfirm?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", cancelOnEscape);
    return () => document.removeEventListener("keydown", cancelOnEscape);
  }, [open]);

  const confirm = () => {
    setOpen(false);
    if (onConfirm) onConfirm();
    else triggerRef.current?.form?.requestSubmit();
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        aria-label={ariaLabel}
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {children}
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            aria-describedby={`${dialogId}-description`}
            aria-labelledby={`${dialogId}-title`}
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-2xl"
            role="alertdialog"
          >
            <h2 className="text-lg font-semibold text-slate-900" id={`${dialogId}-title`}>{title}</h2>
            <div className="mt-2 text-sm leading-6 text-slate-600" id={`${dialogId}-description`}>{description}</div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setOpen(false)}
                ref={cancelRef}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700"
                onClick={confirm}
                type="button"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
