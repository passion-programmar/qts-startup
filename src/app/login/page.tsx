import type { Metadata } from "next";
import { BriefcaseBusiness, FileCheck2, ShieldCheck, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { getCurrentUser } from "@/lib/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign in | QTS",
};

const highlights = [
  { icon: BriefcaseBusiness, text: "Track jobs and bids for every candidate" },
  { icon: Sparkles, text: "Generate tailored resumes with AI prompts" },
  { icon: FileCheck2, text: "Keep application documents in one place" },
];

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-16 size-96 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <BriefcaseBusiness className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">QTS Job System</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-4xl font-bold leading-tight tracking-tight">Your job application workspace.</p>
          <ul className="mt-8 space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li className="flex items-center gap-3 text-indigo-50" key={text}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-indigo-200">
          <ShieldCheck className="size-4" /> Staff access only
        </p>
      </aside>

      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <section className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/25">
              <BriefcaseBusiness className="size-5" />
            </span>
            <p className="text-lg font-bold tracking-tight text-slate-900">QTS Job System</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in with your QTS login name and password.</p>
            <LoginForm />
          </div>
        </section>
      </div>
    </main>
  );
}
