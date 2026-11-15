"use client";

// Staff accounts (Admin, Manager): create in a pop-up, change login, delete. Super Admin and Admin use these.
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Plus,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { ConfirmButton } from "@/app/components/confirm-button";
import { PasswordField } from "@/app/components/password-field";
import { minimumPasswordLength } from "@/lib/password-policy";
import {
  createUserAction,
  deleteStaffUserAction,
  type UserActionState,
  updateUserCredentialsAction,
} from "@/app/users/actions";
import { FormMessage, TextField } from "@/app/users/form-fields";

const initialState: UserActionState = { error: null, success: null };

type CategoryOption = { id: string; name: string };

type CreateUserFormProps = {
  categories?: CategoryOption[];
  role: "admin" | "manager" | "account";
};

// Staff accounts (Admin, Manager) are created in a pop-up; candidates have their own page (CandidateCreateForm).
export function CreateUserForm({ role }: CreateUserFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeModal = useCallback(() => setIsOpen(false), []);
  const [state, formAction, isPending] = useActionState(
    async (previous: UserActionState, formData: FormData) => {
      const result = await createUserAction(previous, formData);
      // A saved account closes the window; its row appears in the list, and the next opening is empty.
      if (result.success) setIsOpen(false);
      return result;
    },
    initialState,
  );
  // Messages belong to this opening, not to an earlier save or error.
  const [openedWith, setOpenedWith] = useState(state);
  const message = state === openedWith ? initialState : state;
  const isAccount = role === "account";
  const roleLabel = isAccount
    ? "Candidate account"
    : role === "admin"
      ? "Admin"
      : "Manager";

  return (
    <>
      <button
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-indigo-600"
        onClick={() => {
          setOpenedWith(state);
          setIsOpen(true);
        }}
        type="button"
      >
        <UserPlus aria-hidden="true" className="size-4" />
        Add {roleLabel}
      </button>
      <Modal
        confirmOnDismiss={isAccount}
        dismissQuestion="Discard this new account?"
        onClose={closeModal}
        open={isOpen}
        subtitle={
          isAccount
            ? "Add contact details and career information for this candidate."
            : "Set up a staff account in your reporting hierarchy."
        }
        title={`Create ${roleLabel}`}
      >
        <form action={formAction} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              autoComplete="off"
              id="loginName"
              label="Username"
              maxLength={128}
              name="loginName"
              required
            />
            <div className="sm:col-span-2">
              <PasswordField
                autoComplete="new-password"
                id="newStaffPassword"
                label="Temporary password"
                minLength={minimumPasswordLength}
                name="password"
                placeholder="At least 4 characters"
                required
              />
            </div>
          </div>

        {message.error && <FormMessage variant="error">{message.error}</FormMessage>}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={isPending}
              type="submit"
            >
              {isPending ? <LoadingIcon className="size-4" /> : <Plus className="size-4" />}
              {isPending ? "Creating..." : `Create ${roleLabel}`}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

type CredentialResetFormProps = {
  userId: string;
  loginName: string;
};

export function CredentialResetForm({
  userId,
  loginName,
}: CredentialResetFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateUserCredentialsAction,
    initialState,
  );

  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-indigo-600 [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="size-3" />
        Change credentials
        <ChevronDown className="size-3 transition group-open:rotate-180" />
      </summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input name="userId" type="hidden" value={userId} />
        <TextField
          autoComplete="off"
          defaultValue={loginName}
          id={`resetLogin-${userId}`}
          label="Login name"
          maxLength={128}
          name="loginName"
        />
        <PasswordField
          autoComplete="new-password"
          id={`resetPassword-${userId}`}
          label="Set a new password (optional)"
          minLength={minimumPasswordLength}
          name="password"
          placeholder="At least 4 characters"
        />
        {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
        {state.success && (
          <FormMessage variant="success">{state.success}</FormMessage>
        )}
        <button
          className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-900 px-3 text-[10px] font-semibold text-white disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending && <LoadingIcon className="size-4" />}
          {isPending ? "Saving..." : "Save credentials"}
        </button>
      </form>
    </details>
  );
}

function Modal({
  open,
  onClose,
  title,
  subtitle,
  confirmOnDismiss = false,
  dismissQuestion,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  confirmOnDismiss?: boolean;
  dismissQuestion: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const leaveConfirmationRef = useRef<HTMLDivElement>(null);
  const showLeaveConfirmationRef = useRef(false);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  // Whether anything in the form was changed since the window opened; only then does closing ask.
  const changedRef = useRef(false);
  const titleId = useId();
  const subtitleId = useId();

  const updateLeaveConfirmation = useCallback((show: boolean) => {
    showLeaveConfirmationRef.current = show;
    setShowLeaveConfirmation(show);
  }, []);
  const requestClose = useCallback(() => {
    if (confirmOnDismiss && changedRef.current) {
      updateLeaveConfirmation(true);
    } else {
      onClose();
    }
  }, [confirmOnDismiss, onClose, updateLeaveConfirmation]);
  const cancelAndClose = useCallback(() => {
    updateLeaveConfirmation(false);
    onClose();
  }, [onClose, updateLeaveConfirmation]);
  const continueEditing = useCallback(() => {
    updateLeaveConfirmation(false);
    dialogRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')
      ?.focus();
  }, [updateLeaveConfirmation]);

  useEffect(() => {
    if (!open) return;

    changedRef.current = false;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocusScope = showLeaveConfirmationRef.current
      ? leaveConfirmationRef.current
      : dialogRef.current;
    const firstFocusable = initialFocusScope?.querySelector<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? dialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (showLeaveConfirmationRef.current) {
          continueEditing();
        } else {
          requestClose();
        }
        return;
      }

      const focusScope = showLeaveConfirmationRef.current
        ? leaveConfirmationRef.current
        : dialogRef.current;
      if (event.key !== "Tab" || !focusScope) return;
      const focusableElements = focusScope.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [continueEditing, open, requestClose, updateLeaveConfirmation]);

  useEffect(() => {
    if (showLeaveConfirmation) {
      // "Keep editing" has the focus, so Enter never throws work away.
      leaveConfirmationRef.current
        ?.querySelector<HTMLButtonElement>("button[data-keep-editing]")
        ?.focus();
    }
  }, [showLeaveConfirmation]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        aria-describedby={subtitleId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5"
          inert={showLeaveConfirmation}
        >
          <div>
            <h2
              className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl"
              id={titleId}
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500" id={subtitleId}>
              {subtitle}
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            onClick={requestClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div
          className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
          inert={showLeaveConfirmation}
          onChangeCapture={() => {
            changedRef.current = true;
          }}
          onClickCapture={(event) => {
            // Calendars and "Add" buttons change the form without typing.
            if ((event.target as HTMLElement).closest("[data-changes-form]")) changedRef.current = true;
          }}
          onInputCapture={() => {
            changedRef.current = true;
          }}
        >
          {children}
        </div>
        {showLeaveConfirmation && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/35 p-4">
            <div
              aria-describedby={`${titleId}-leave-description`}
              aria-labelledby={`${titleId}-leave-title`}
              aria-modal="true"
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
              ref={leaveConfirmationRef}
              role="alertdialog"
            >
              <h3
                className="text-base font-semibold text-slate-900"
                id={`${titleId}-leave-title`}
              >
                {dismissQuestion}
              </h3>
              <p
                className="mt-2 text-sm leading-6 text-slate-600"
                id={`${titleId}-leave-description`}
              >
                You changed this form but have not saved it. Discarding closes it and loses those changes.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className="min-h-10 rounded-lg border border-rose-200 px-4 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                  onClick={cancelAndClose}
                  type="button"
                >
                  Discard changes
                </button>
                <button
                  className="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  data-keep-editing
                  onClick={continueEditing}
                  type="button"
                >
                  Keep editing
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DeleteStaffUserForm({
  userId,
  reportsCount,
  replacementUsers,
}: {
  userId: string;
  reportsCount: number;
  replacementUsers: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(
    deleteStaffUserAction,
    initialState,
  );
  const hasReports = reportsCount > 0;
  const noReplacementAvailable = hasReports && replacementUsers.length === 0;

  return (
    <form action={formAction} className="mt-2">
      <input name="userId" type="hidden" value={userId} />
      {hasReports && replacementUsers.length > 0 && (
        <div className="mb-3">
          <label
            className="mb-2 block text-[10px] font-semibold text-slate-600"
            htmlFor={`replacementUser-${userId}`}
          >
            Reassign {reportsCount} direct report(s) to
          </label>
          <select
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            defaultValue=""
            id={`replacementUser-${userId}`}
            name="replacementUserId"
            required
          >
            <option disabled value="">
              Choose an active peer
            </option>
            {replacementUsers.map((replacement) => (
              <option key={replacement.id} value={replacement.id}>
                {replacement.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {noReplacementAvailable && (
        <FormMessage variant="error">
          Add another active peer at this level before deleting this account.
        </FormMessage>
      )}
      {state.error && (
        <FormMessage variant="error">{state.error}</FormMessage>
      )}
      {state.success && (
        <FormMessage variant="success">{state.success}</FormMessage>
      )}
      <ConfirmButton
        className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        confirmLabel="Delete account"
        description={hasReports
          ? `Permanently delete this staff account and reassign ${reportsCount} direct report(s) to the selected peer? Their login history is deleted too. This cannot be undone.`
          : "Permanently delete this staff account? Their login history is deleted too. This cannot be undone."}
        disabled={isPending || noReplacementAvailable}
        title="Delete this account?"
      >
        {isPending && <LoadingIcon className="size-3.5" />}
        {isPending ? "Deleting..." : "Delete account"}
      </ConfirmButton>
    </form>
  );
}
