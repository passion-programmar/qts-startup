"use client";

import { useActionState } from "react";
import { PlugZap, Trash2 } from "lucide-react";
import { saveVerificationMailboxAction, type ProfileState } from "@/app/profile/actions";
import { LoadingIcon } from "@/app/components/loading-icon";
import { PasswordField } from "@/app/components/password-field";

const initialState: ProfileState = { error: null, success: null };

const inputClass = "h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
const labelClass = "mb-2 block text-xs font-semibold text-slate-700";

// The Manager's verification mailbox: address, IMAP server and app password. Save logs in first and
// keeps it only when the login works. The app password is never shown once saved.
export function VerificationMailboxForm({ address, host }: { address: string | null; host: string | null }) {
  const [state, formAction, isPending] = useActionState(saveVerificationMailboxAction, initialState);
  const saved = Boolean(address);

  return (
    <form action={formAction} className="space-y-5">
      <p className="text-xs text-slate-500">
        {saved
          ? `Connected: ${address}. To change it, type the details again (the app password too).`
          : "No mailbox yet. Apply leaves codes and links sent by email to you until one is saved."}
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="verificationMailAddress">Mailbox address</label>
          <input
            autoComplete="off"
            className={inputClass}
            defaultValue={address ?? ""}
            id="verificationMailAddress"
            name="verificationMailAddress"
            placeholder="name.qts@gmail.com"
            type="email"
          />
        </div>
        <PasswordField
          autoComplete="off"
          id="verificationMailPassword"
          label="App password (16 letters)"
          name="verificationMailPassword"
        />
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="verificationMailHost">IMAP server (leave empty for Gmail)</label>
          <input
            autoComplete="off"
            className={inputClass}
            defaultValue={host && host !== "imap.gmail.com" ? host : ""}
            id="verificationMailHost"
            name="verificationMailHost"
            placeholder="imap.gmail.com"
            type="text"
          />
        </div>
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
          {isPending ? <LoadingIcon className="size-3.5" /> : <PlugZap className="size-3.5" />}
          {isPending ? "Connecting..." : "Test connection and save"}
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
