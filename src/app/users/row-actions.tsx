"use client";

// The controls in each candidate row of the People list that save something or copy text.
import { startTransition, useActionState, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Ellipsis, Eye, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { deleteCandidateAccountAction, setLinkedInStatusAction, toggleCandidateAccountStatusAction, type UserActionState } from "@/app/users/actions";
import { LINKEDIN_STATUS_LABELS, LINKEDIN_STATUSES, type LinkedInStatus } from "@/server/users/linkedin-status";
import { Button } from "@/app/ui/button";
import { cn } from "@/app/ui/cn";
import { Menu, MenuItem, MenuLink } from "@/app/ui/menu";
import { Switch } from "@/app/ui/switch";

const initialState: UserActionState = { error: null, success: null };

/** The page's "Copied" message listens for this (see CopyToast in candidate-board.tsx). */
export const COPIED_EVENT = "qts:copied";

function RowError({ message }: { message: string | null }) {
  return message ? (
    <span className="mt-1 block max-w-40 text-[11px] leading-tight text-danger-text" role="alert">{message}</span>
  ) : null;
}

/**
 * Active / Inactive. An inactive candidate is left out of Get JD, Generation and Apply. Clicking the
 * switch asks Yes / No first (user, 2026-11-28); Yes saves.
 */
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
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <form action={formAction} onSubmit={() => dialog.current?.close()}>
      <input name="userId" type="hidden" value={userId} />
      <Switch
        aria-label={active ? `Set ${candidateName} inactive` : `Set ${candidateName} active`}
        checked={active}
        label={isPending ? "Saving..." : active ? "Active" : "Inactive"}
        loading={isPending}
        onClick={() => dialog.current?.showModal()}
        title={active ? "Active: click to set inactive" : "Inactive: click to set active"}
        tone="success"
      />
      <dialog
        aria-labelledby={`active-title-${userId}`}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-card p-5 text-left text-fg shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px]"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        ref={dialog}
      >
        <h2 className="text-base font-semibold" id={`active-title-${userId}`}>
          {active ? `Set ${candidateName} inactive?` : `Set ${candidateName} active?`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          {active
            ? "They will be left out of Get JD, Generation and Apply until set active again."
            : "They will be used again for Get JD, Generation and Apply."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          {/* No is first and focused, so Enter never changes it by accident. */}
          <Button autoFocus onClick={() => dialog.current?.close()} variant="secondary">No</Button>
          <Button type="submit" variant={active ? "danger" : "primary"}>{active ? "Yes, set inactive" : "Yes, set active"}</Button>
        </div>
      </dialog>
      <RowError message={state.error} />
    </form>
  );
}

/**
 * The row's ⋯ menu: Edit (View for a deleted candidate) and Delete. Delete works only for an
 * inactive candidate (the server refuses an active one too) and asks first.
 */
export function CandidateRowMenu({
  userId,
  candidateName,
  active,
  deleted,
}: {
  userId: string;
  candidateName: string;
  active: boolean;
  deleted: boolean;
}) {
  const [state, formAction, isPending] = useActionState(deleteCandidateAccountAction, initialState);
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="flex flex-col items-end">
      <Menu
        align="end"
        label={`Actions for ${candidateName}`}
        trigger={isPending
          ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          : <Ellipsis aria-hidden="true" className="size-4" />}
        triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-line-soft hover:text-fg focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-55"
        disabled={isPending}
      >
        <>
            <MenuLink href={`/users/${userId}/edit`} newTab icon={deleted ? <Eye aria-hidden="true" className="size-4" /> : <Pencil aria-hidden="true" className="size-4" />}>
              {deleted ? "View profile" : "Edit profile"}
            </MenuLink>
            {deleted ? null : (
              <MenuItem
                disabled={active}
                focusTrigger={false}
                hint={active ? "Set inactive first" : undefined}
                icon={<Trash2 aria-hidden="true" className="size-4" />}
                onSelect={() => dialog.current?.showModal()}
                tone="danger"
              >
                Delete
              </MenuItem>
            )}
        </>
      </Menu>
      <dialog
        aria-labelledby={`delete-title-${userId}`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-card p-5 text-left text-fg shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px]"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        ref={dialog}
      >
        <h2 className="text-base font-semibold" id={`delete-title-${userId}`}>Delete {candidateName}?</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Their profile, Jobs, Bids and history stay viewable but read-only, and they are no longer used for Get JD, Generation or Apply. This cannot be undone.
        </p>
        <form action={formAction} className="mt-5 flex justify-end gap-2" onSubmit={() => dialog.current?.close()}>
          <input name="userId" type="hidden" value={userId} />
          {/* Cancel is first, so Enter on the opened dialog never deletes by accident. */}
          <Button autoFocus onClick={() => dialog.current?.close()} variant="secondary">Cancel</Button>
          <Button type="submit" variant="danger">Delete candidate</Button>
        </form>
      </dialog>
      <RowError message={state.error} />
    </div>
  );
}

/** Text that copies itself when clicked; the page then shows "Copied". "icon" adds a copy icon on hover. */
export function CopyableAccountField({
  value,
  ariaLabel,
  className = "",
  icon = false,
  children,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  icon?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn("group/copy inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-primary-text", className)}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => window.dispatchEvent(new CustomEvent(COPIED_EVENT, { detail: value })),
          () => window.dispatchEvent(new CustomEvent(COPIED_EVENT, { detail: null })),
        );
      }}
      title="Click to copy"
      type="button"
    >
      {children}
      {icon ? <Copy aria-hidden="true" className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-70 group-focus-visible/copy:opacity-70" /> : null}
    </button>
  );
}

// Each LinkedIn status in the app's own badge colours (src/app/ui/badge.tsx), right in both themes.
export const LINKEDIN_STATUS_STYLES: Record<LinkedInStatus, { dot: string; badge: string }> = {
  none: { dot: "bg-slate-400", badge: "bg-line-soft text-fg-muted ring-line" },
  live: { dot: "bg-success", badge: "bg-success-soft text-success-text ring-success-ring" },
  applying: { dot: "bg-primary", badge: "bg-primary-soft text-primary-text ring-primary-ring" },
  blocked: { dot: "bg-danger", badge: "bg-danger-soft text-danger-text ring-danger-ring" },
};

const LINKEDIN_STATUS_HINTS: Record<LinkedInStatus, string> = {
  none: "No LinkedIn account yet",
  live: "Account works",
  applying: "Used for Easy Apply",
  blocked: "Account blocked",
};

/**
 * The LinkedIn account signal: a badge that opens a menu (None / Live / Applying / Blocked). A new
 * choice asks Yes / No first (user, 2026-11-28) and is saved on Yes. Hovering shows since when.
 */
export function LinkedInStatusMenu({
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
  const [picked, setPicked] = useState<LinkedInStatus | null>(null);
  // The choice waiting for Yes / No in the dialog.
  const [asked, setAsked] = useState<LinkedInStatus | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // While saving, the badge already shows the new choice.
  const shown = isPending && picked ? picked : status;
  const style = LINKEDIN_STATUS_STYLES[shown];
  const since = changedAt
    ? `${LINKEDIN_STATUS_LABELS[status]} since ${new Date(changedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : LINKEDIN_STATUS_LABELS[status];

  function ask(next: LinkedInStatus) {
    if (next === status) return;
    setAsked(next);
    dialog.current?.showModal();
  }

  function choose(next: LinkedInStatus) {
    dialog.current?.close();
    setAsked(null);
    setPicked(next);
    const form = new FormData();
    form.set("userId", userId);
    form.set("linkedinStatus", next);
    startTransition(() => formAction(form));
  }

  return (
    <div>
      <Menu
        disabled={isPending}
        label={`LinkedIn status for ${candidateName}`}
        title={`${since} · click to change`}
        trigger={
          <>
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
            {LINKEDIN_STATUS_LABELS[shown]}
            {isPending
              ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin opacity-70" />
              : <ChevronDown aria-hidden="true" className="size-3 opacity-70" />}
          </>
        }
        triggerClassName={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait",
          style.badge,
        )}
      >
        {LINKEDIN_STATUSES.map((value) => (
          <MenuItem
            checked={value === status}
            hint={LINKEDIN_STATUS_HINTS[value]}
            icon={<span aria-hidden="true" className={cn("size-2 rounded-full", LINKEDIN_STATUS_STYLES[value].dot)} />}
            key={value}
            focusTrigger={value === status}
            onSelect={() => ask(value)}
          >
            {LINKEDIN_STATUS_LABELS[value]}
          </MenuItem>
        ))}
      </Menu>
      <dialog
        aria-labelledby={`linkedin-title-${userId}`}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-card p-5 text-left text-fg shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px]"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onClose={() => setAsked(null)}
        ref={dialog}
      >
        <h2 className="text-base font-semibold" id={`linkedin-title-${userId}`}>Change LinkedIn status?</h2>
        {asked ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            {candidateName}:
            <StatusChip status={status} />
            <span aria-hidden="true">→</span>
            <span className="sr-only">to</span>
            <StatusChip status={asked} />
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          {/* No is first and focused, so Enter never changes the status by accident. */}
          <Button autoFocus onClick={() => dialog.current?.close()} variant="secondary">No</Button>
          <Button onClick={() => asked && choose(asked)}>Yes, change</Button>
        </div>
      </dialog>
      <RowError message={state.error} />
    </div>
  );
}

function StatusChip({ status }: { status: LinkedInStatus }) {
  const style = LINKEDIN_STATUS_STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", style.badge)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", style.dot)} />
      {LINKEDIN_STATUS_LABELS[status]}
    </span>
  );
}
