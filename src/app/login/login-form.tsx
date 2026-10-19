"use client";

import { useActionState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import { loginAction, type LoginState } from "@/app/login/actions";
import { PasswordField } from "@/app/components/password-field";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <div>
        <label
          className="mb-2 block text-xs font-semibold text-slate-700"
          htmlFor="loginName"
        >
          Login name
        </label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="username"
            autoFocus
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            id="loginName"
            maxLength={128}
            name="loginName"
            placeholder="Your login name"
            required
          />
        </div>
      </div>

      <PasswordField
        autoComplete="current-password"
        id="password"
        label="Password"
        name="password"
        placeholder="Enter your password"
        required
      />

      {state.error && (
        <p
          aria-live="polite"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700"
          role="alert"
        >
          {state.error}
        </p>
      )}

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-wait disabled:opacity-70"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Signing in..." : "Sign in"}
        {!isPending && <ArrowRight className="size-4" />}
      </button>
    </form>
  );
}
