import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

        <div aria-hidden="true" className="relative flex flex-1 items-center justify-center">
          <div className="absolute size-72 rounded-full border border-white/10 xl:size-96" />
          <div className="absolute size-56 rounded-full border border-white/10 xl:size-72" />
          <div className="relative flex size-40 items-center justify-center rounded-[2.5rem] border border-white/15 bg-white/10 text-7xl font-bold tracking-tighter text-white shadow-2xl backdrop-blur xl:size-52 xl:text-8xl">
            q
          </div>
        </div>

        <div className="relative flex gap-2 pb-2">
          <span className="h-1.5 w-10 rounded-full bg-indigo-400" />
          <span className="h-1.5 w-4 rounded-full bg-white/20" />
          <span className="h-1.5 w-4 rounded-full bg-white/20" />
        </div>
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Welcome back</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Sign in
          </h2>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
