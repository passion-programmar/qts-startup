"use client";

// The buttons in each candidate row of the People list that save something or copy text.
import { useActionState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { deleteCandidateAccountAction, setLinkedInStatusAction, toggleCandidateAccountStatusAction, type UserActionState } from "@/app/users/actions";
import { LINKEDIN_STATUS_LABELS, LINKEDIN_STATUSES, type LinkedInStatus } from "@/server/users/linkedin-status";
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

// Each LinkedIn status in the app's own badge colours (src/app/ui/badge.tsx), right in both themes.
const LINKEDIN_STATUS_STYLES: Record<LinkedInStatus, { dot: string; badge: string }> = {
  live: { dot: "bg-success", badge: "bg-success-soft text-success-text ring-success-ring" },
  applying: { dot: "bg-primary", badge: "bg-primary-soft text-primary-text ring-primary-ring" },
  blocked: { dot: "bg-danger", badge: "bg-danger-soft text-danger-text ring-danger-ring" },
};

/**
 * The LinkedIn account signal: a badge that is a menu (Live / Applying / Blocked), saved as soon as
 * one is picked. Hovering shows since when.
 */
export function LinkedInStatusForm({
  userId,
  candidateName,
  status,
  changedAt,
}: {
  userId: string;
  candidateName: string;
  status: LinkedInStatus;
  changedAt: string | null;
}) {
  const [state, formAction, isPending] = useActionState(setLinkedInStatusAction, initialState);
  const style = LINKEDIN_STATUS_STYLES[status];
  const since = changedAt
    ? `${LINKEDIN_STATUS_LABELS[status]} since ${new Date(changedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : LINKEDIN_STATUS_LABELS[status];
  return (
    <form action={formAction}>
      <input name="userId" type="hidden" value={userId} />
      <label className={`relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style.badge}`} title={`${since} · click to change`}>
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${style.dot}`} />
        <select
          aria-label={`LinkedIn status for ${candidateName}`}
          className="cursor-pointer appearance-none bg-transparent pr-3 font-semibold outline-none disabled:cursor-wait"
          defaultValue={status}
          disabled={isPending}
          key={status}
          name="linkedinStatus"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {LINKEDIN_STATUSES.map((value) => (
            <option className="bg-surface text-fg" key={value} value={value}>{LINKEDIN_STATUS_LABELS[value]}</option>
          ))}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-2 text-[9px] opacity-70">▾</span>
      </label>
      <RowError message={state.error} />
    </form>
  );
}

export function CopyLinkedInUrl({ url }: { url: string }) {
  return (
    <CopyableAccountField ariaLabel="Copy LinkedIn URL" className="text-xs font-semibold text-primary-text hover:underline" value={url}>
      LinkedIn
    </CopyableAccountField>
  );
}
