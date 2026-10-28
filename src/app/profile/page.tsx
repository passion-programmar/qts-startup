import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { KeyRound, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/app/profile/profile-form";
import { SiteAccountPasswordForm } from "@/app/profile/site-account-password-form";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";

export const instant = false;

export const metadata: Metadata = {
  title: "My profile | QTS",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [siteAccount] = user.role === "manager"
    ? await db.select({ password: users.siteAccountPassword }).from(users).where(eq(users.id, user.id)).limit(1)
    : [];

  return (
    <WorkspaceShell activeHref="/profile" user={user}>
    <main className="py-1">
      <div className="mx-auto max-w-3xl">
        <PageHeader description="Update your display name, login name, and password." title="My profile" />

        <section className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-lg font-bold text-white shadow-md shadow-indigo-500/25">
            {user.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "Q"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">{user.displayName}</p>
            <p className="mt-0.5 truncate text-sm text-slate-500">@{user.loginName}</p>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
            <KeyRound className="size-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-800">
              Sign-in details
            </h2>
          </div>
          <ProfileForm
            displayName={user.displayName}
            loginName={user.loginName}
          />
        </section>

        {user.role === "manager" && (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-6 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <LockKeyhole className="size-4 text-indigo-600" />
                <h2 className="text-sm font-semibold text-slate-800">Site account password</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                The one password for your candidates&apos; accounts on job sites. Apply fills it on sign-in and
                create-account pages (with the candidate&apos;s email); you click Sign in or Create account yourself.
              </p>
            </div>
            <SiteAccountPasswordForm saved={Boolean(siteAccount?.password)} />
          </section>
        )}
      </div>
    </main>
    </WorkspaceShell>
  );
}
