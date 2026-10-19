import type { Metadata } from "next";
import { KeyRound, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/app/profile/profile-form";
import { getCurrentUser } from "@/lib/session";

export const instant = false;

export const metadata: Metadata = {
  title: "My profile | QTS",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <UserRound className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-indigo-600">Account</p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                My profile
              </h1>
            </div>
          </div>
          <Link
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            href="/"
          >
            Back to dashboard
          </Link>
        </div>

        <section className="mt-7 rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-7">
          <div className="mb-6 flex items-start gap-3 border-b border-slate-100 pb-5">
            <KeyRound className="mt-0.5 size-4 text-indigo-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                Staff credentials
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Update your display name, login name, or password. Candidate
                Accounts do not have login credentials.
              </p>
            </div>
          </div>
          <ProfileForm
            displayName={user.displayName}
            loginName={user.loginName}
          />
        </section>
      </div>
    </main>
  );
}
