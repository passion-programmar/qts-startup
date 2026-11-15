"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/app/ui/button";

/**
 * A button that asks before acting, in the browser's own modal dialog (focus trap, Escape and the
 * backdrop come built in). Confirming calls onConfirm, or else submits the form the button sits in.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = "danger",
  onConfirm,
  trigger,
  triggerVariant = "secondary",
  triggerSize = "sm",
  triggerIcon,
  triggerLabel,
  disabled = false,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm?: () => void;
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerIcon?: ReactNode;
  triggerLabel?: string;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const confirm = () => {
    dialog.current?.close();
    if (onConfirm) onConfirm();
    else triggerRef.current?.form?.requestSubmit();
  };

  return (
    <>
      <Button
        aria-label={triggerLabel}
        disabled={disabled}
        icon={triggerIcon}
        onClick={() => dialog.current?.showModal()}
        ref={triggerRef}
        size={triggerSize}
        variant={triggerVariant}
      >
        {trigger}
      </Button>
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-card p-5 text-fg shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px]"
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself, outside its content) cancels.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        ref={dialog}
      >
        <h2 className="text-base font-semibold" id={titleId}>{title}</h2>
        <div className="mt-2 text-sm leading-6 text-fg-muted" id={descriptionId}>{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          {/* Cancel is first, so Enter on the opened dialog never confirms by accident. */}
          <Button autoFocus onClick={() => dialog.current?.close()} variant="secondary">Cancel</Button>
          <Button onClick={confirm} variant={tone}>{confirmLabel}</Button>
        </div>
      </dialog>
    </>
  );
}
