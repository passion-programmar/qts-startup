"use client";

// The buttons in each candidate row of the People list that save something or copy text.
import { useActionState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { deleteCandidateAccountAction, toggleCandidateAccountStatusAction, type UserActionState } from "@/app/users/actions";
import { ConfirmDialog } from "@/app/ui/confirm-dialog";
import { Switch } from "@/app/ui/switch";

const initialState: UserActionState = { error: null, success: null };

function RowError({ message }: { message: string | null }) {
  return message ? (
    <span className="mt-1 block max-w-36 text-[10px] leading-tight text-danger-text" role="alert">{message}</span>
  ) : null;
}

/** Active / Inactive. An inactive candidate is left out of Get JD, Generation and Apply. */
export function ToggleCandidateAccountStatusForm({
  userId,
  candidateName,
  active,
}: {
  userId: string;
  candidateName: string;
  active: boolean;
}) {
  const [state, formAction, isPending] = useActionState(toggleCandidateAccountStatusAction, initialState);
  return (
    <form action={formAction}>
      <input name="userId" type="hidden" value={userId} />
      <Switch
        aria-label={active ? `Set ${candidateName} inactive` : `Set ${candidateName} active`}
        checked={active}
        label={isPending ? "Saving..." : active ? "Active" : "Inactive"}
        loading={isPending}
        title={active ? "Active: click to set inactive" : "Inactive: click to set active"}
        tone="success"
        type="submit"
      />
      <RowError message={state.error} />
    </form>
  );
}

/** Delete, shown only for an inactive candidate; the server refuses an active one too. */
export function DeleteCandidateAccountForm({
  userId,
  candidateName,
  active,
}: {
  userId: string;
  candidateName: string;
  active: boolean;
}) {
  const [state, formAction, isPending] = useActionState(deleteCandidateAccountAction, initialState);
  if (active) return null;
  return (
    <form action={formAction}>
      <input name="userId" type="hidden" value={userId} />
      <ConfirmDialog
        confirmLabel="Delete candidate"
        description={<>Delete {candidateName}? Their profile, Jobs, Bids, and history stay viewable but read-only on this page, and they are no longer used for Get JD, Generation, or Apply. This cannot be undone.</>}
        disabled={isPending}
        title="Delete this candidate?"
        trigger={isPending ? "Deleting..." : "Delete"}
        triggerIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
        triggerLabel={`Delete ${candidateName}`}
        triggerVariant="dangerSoft"
      />
      <RowError message={state.error} />
    </form>
  );
}

/** Text in a cell that copies itself when clicked. */
export function CopyableAccountField({
  value,
  ariaLabel,
  className = "",
  children,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`block w-full cursor-copy text-left transition-colors hover:text-primary-text ${className}`}
      onClick={() => void navigator.clipboard.writeText(value)}
      title="Click to copy"
      type="button"
    >
      {children}
    </button>
  );
}

export function CopyLinkedInUrl({ url }: { url: string }) {
  return (
    <CopyableAccountField ariaLabel="Copy LinkedIn URL" className="text-xs font-semibold text-primary-text hover:underline" value={url}>
      LinkedIn
    </CopyableAccountField>
  );
}
