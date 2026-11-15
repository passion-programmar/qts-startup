"use client";

import { useActionState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import { loginAction, type LoginState } from "@/app/login/actions";
import { PasswordField } from "@/app/components/password-field";
import { Button } from "@/app/ui/button";
import { Notice } from "@/app/ui/feedback";

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
          className="mb-2 block text-xs font-semibold text-fg-soft"
          htmlFor="loginName"
        >
          Login name
        </label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
          <input
            autoComplete="username"
            autoFocus
            className="h-11 w-full rounded-control border border-line bg-card pl-10 pr-3 text-sm text-fg shadow-sm outline-none transition-colors placeholder:text-fg-faint hover:border-slate-300 focus:border-primary focus:ring-3 focus:ring-primary-soft"
            id="loginName"
            maxLength={128}
            name="loginName"
            required
          />
        </div>
      </div>

      <PasswordField
        autoComplete="current-password"
        id="password"
        label="Password"
        name="password"
        required
      />

      {state.error && <Notice tone="danger">{state.error}</Notice>}

      <Button className="h-11 w-full" loading={isPending} type="submit">
        {isPending ? "Signing in..." : "Sign in"}
        {!isPending && <ArrowRight aria-hidden="true" className="size-4" />}
      </Button>
    </form>
  );
}
