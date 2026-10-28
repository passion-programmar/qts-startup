"use client";

import { useActionState } from "react";
import { Check, Trash2 } from "lucide-react";
import { saveSiteAccountPasswordAction, type ProfileState } from "@/app/profile/actions";
import { LoadingIcon } from "@/app/components/loading-icon";
import { PasswordField } from "@/app/components/password-field";

const initialState: ProfileState = { error: null, success: null };

// The Manager's one password for the candidates' job-site accounts. Never shown once saved.
export function SiteAccountPasswordForm({ saved }: { saved: boolean }) {
  const [state, formAction, isPending] = useActionState(saveSiteAccountPasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <p className="text-xs text-slate-500">
        {saved
          ? "A password is saved. Type a new one to change it."
          : "No password is saved yet. Apply leaves password boxes to you until one is saved."}
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <PasswordField
          autoComplete="off"
          id="siteAccountPassword"
          label={saved ? "New password" : "Password"}
          name="siteAccountPassword"
        />
        <PasswordField
          autoComplete="off"
          id="confirmSiteAccountPassword"
          label="Confirm password"
          name="confirmSiteAccountPassword"
        />
      </div>

      {state.error && (
        <p aria-live="polite" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-700" role="status">
          {state.success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
          disabled={isPending}
          name="intent"
          type="submit"
          value="save"
        >
          {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
          {isPending ? "Saving..." : "Save password"}
        </button>
        {saved && (
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-70"
            disabled={isPending}
            formNoValidate
            name="intent"
            type="submit"
            value="remove"
          >
            <Trash2 className="size-3.5" />
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
