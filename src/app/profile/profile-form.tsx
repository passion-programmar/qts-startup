"use client";

import { useActionState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { updateProfileAction, type ProfileState } from "@/app/profile/actions";
import { PasswordField } from "@/app/components/password-field";

const initialState: ProfileState = { error: null, success: null };

type ProfileFormProps = {
  displayName: string;
  loginName: string;
};

export function ProfileForm({ displayName, loginName }: ProfileFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateProfileAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            className="mb-2 block text-xs font-semibold text-slate-700"
            htmlFor="displayName"
          >
            Display name
          </label>
          <input
            autoComplete="name"
            className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            defaultValue={displayName}
            id="displayName"
            maxLength={120}
            name="displayName"
            required
          />
        </div>
        <div>
          <label
            className="mb-2 block text-xs font-semibold text-slate-700"
            htmlFor="loginName"
          >
            Login name
          </label>
          <input
            autoComplete="username"
            className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            defaultValue={loginName}
            id="loginName"
            maxLength={128}
            name="loginName"
            required
          />
        </div>
      </div>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-indigo-600" />
          <div>
            <p className="text-xs font-semibold text-slate-800">
              Passwords are stored securely
            </p>
            <p className="mt-1 text-[11px] leading-5 text-slate-600">
              Existing passwords cannot be viewed. Enter your current password
              to confirm changes; leave the new-password fields blank to keep
              it unchanged.
            </p>
          </div>
        </div>
      </div>

      <PasswordField
        autoComplete="current-password"
        id="currentPassword"
        label="Current password"
        name="currentPassword"
        placeholder="Confirm your identity"
        required
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <PasswordField
          autoComplete="new-password"
          id="newPassword"
          label="New password"
          name="newPassword"
          placeholder="At least 4 characters"
          minLength={4}
        />
        <PasswordField
          autoComplete="new-password"
          id="confirmPassword"
          label="Confirm new password"
          name="confirmPassword"
          placeholder="Repeat the new password"
          minLength={4}
        />
      </div>

      {state.error && (
        <p
          aria-live="polite"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700"
          role="alert"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-700"
          role="status"
        >
          {state.success}
        </p>
      )}

      <button
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
        disabled={isPending}
        type="submit"
      >
        <Check className="size-3.5" />
        {isPending ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
