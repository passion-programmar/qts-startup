"use client";

import { useId, useRef, type ReactNode } from "react";

// One confirmation for every delete or stop in the app: a button that first asks, in the browser's own
// modal dialog naming what happens, then submits its form (or runs onConfirm). Cancel has the focus;
// Escape and a click outside cancel, so nothing is lost by a stray click or key.
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  children,
  className,
  ariaLabel,
  disabled = false,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  // The button that keeps things as they are (first and focused, so Enter never confirms).
  cancelLabel?: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  // Without it, confirming submits the form the button sits in.
  onConfirm?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const confirm = () => {
    dialog.current?.close();
    if (onConfirm) onConfirm();
    else triggerRef.current?.form?.requestSubmit();
  };

  return (
    <>
      <button
        aria-label={ariaLabel}
        className={className}
        disabled={disabled}
        onClick={() => dialog.current?.showModal()}
        ref={triggerRef}
        type="button"
      >
        {children}
      </button>
      <dialog
        aria-describedby={`${dialogId}-description`}
        aria-labelledby={`${dialogId}-title`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-card p-6 text-left text-fg shadow-2xl backdrop:bg-slate-950/55"
        onClick={(event) => {
          // A click on the backdrop (outside the content) cancels.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        ref={dialog}
        role="alertdialog"
      >
        <h2 className="text-lg font-semibold" id={`${dialogId}-title`}>{title}</h2>
        <div className="mt-2 text-sm leading-6 text-fg-muted" id={`${dialogId}-description`}>{description}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            autoFocus
            className="min-h-10 rounded-control border border-line px-4 text-sm font-medium text-fg-soft hover:bg-subtle"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="min-h-10 rounded-control bg-danger px-4 text-sm font-semibold text-white hover:bg-danger-hover"
            onClick={confirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
