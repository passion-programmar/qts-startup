import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/app/profile/profile-form";
import { getCurrentUser } from "@/lib/session";
import { WorkspaceShell } from "@/app/components/workspace-shell";

export const instant = false;

export const metadata: Metadata = {
  title: "My profile | QTS",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <WorkspaceShell activeHref="/profile" user={user}>
    <main className="py-1">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                My profile
              </h1>
            </div>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
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
      </div>
    </main>
    </WorkspaceShell>
  );
}
