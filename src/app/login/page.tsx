import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { LoginForm } from "@/app/login/login-form";
import { getCurrentUser } from "@/lib/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign in | QTS",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-28 top-16 size-[440px] rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="absolute -bottom-32 -left-28 size-[420px] rounded-full bg-blue-500/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500 text-base font-bold">
            q
          </div>
          <span className="text-lg font-semibold tracking-tight">
            qts<span className="text-indigo-400">.</span>
          </span>
        </div>

        <div className="relative max-w-lg pb-12">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-indigo-200">
            <Sparkles className="size-3.5" />
            Your job search, in one workspace
          </div>
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-[-0.04em] xl:text-5xl">
            Find your next
            <br />
            great opportunity.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-slate-300">
            Keep candidate profiles, applications, and career documents
            organized in a workspace built for your team.
          </p>
          <div className="mt-10 flex items-center gap-2 text-xs text-slate-400">
            <span className="size-2 rounded-full bg-emerald-400" />
            Secure team access
            <span className="px-1 text-slate-600">·</span>
            Role-based workspace
          </div>
        </div>

        <p className="relative text-[10px] text-slate-500">
          QTS Job Application Workspace
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-[390px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
              q
            </div>
            <span className="text-lg font-semibold tracking-tight">
              qts<span className="text-indigo-600">.</span>
            </span>
          </div>
          <p className="text-xs font-medium text-indigo-600">Welcome back</p>
          <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-slate-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Enter the staff login credentials provided by your administrator.
          </p>
          <LoginForm />
          <p className="mt-8 text-center text-[11px] leading-5 text-slate-400">
            Candidate Accounts are managed by their assigned Manager and do not
            sign in.
          </p>
        </div>
      </section>
    </main>
  );
}
