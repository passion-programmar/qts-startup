import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { KeyRound, LockKeyhole, MailCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/app/profile/profile-form";
import { SiteAccountPasswordForm } from "@/app/profile/site-account-password-form";
import { VerificationMailboxForm } from "@/app/profile/verification-mailbox-form";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { Badge } from "@/app/ui/badge";
import { Card, CardHeader } from "@/app/ui/card";
import { PageHeader } from "@/app/ui/page-header";

export const instant = false;

export const metadata: Metadata = {
  title: "My profile | QTS",
};

const roleLabels = { super_admin: "Super Admin", admin: "Admin", manager: "Manager" } as const;

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Reusable answers have their own page now (Answers).
  const [siteAccount] = user.role === "manager"
    ? await db.select({ password: users.siteAccountPassword, mailAddress: users.verificationMailAddress, mailHost: users.verificationMailHost }).from(users).where(eq(users.id, user.id)).limit(1)
    : [];
  const initials = user.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "Q";

  return (
    <main className="mx-auto max-w-3xl space-y-5 py-1">
      <PageHeader description="Update your display name, login name, and password." title="My profile" />

      <Card className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-500 text-lg font-bold text-white shadow-md shadow-indigo-500/25">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-fg">{user.displayName}</p>
          <p className="mt-0.5 truncate text-sm text-fg-muted">@{user.loginName}</p>
        </div>
        <Badge className="ml-auto" tone="primary">{roleLabels[user.role]}</Badge>
      </Card>

      <Card>
        <CardHeader className="mb-6 border-b border-line-soft pb-4" icon={<KeyRound />} title="Sign-in details" />
        <ProfileForm displayName={user.displayName} loginName={user.loginName} />
      </Card>

      {user.role === "manager" && (
        <Card>
          <CardHeader
            className="mb-6 border-b border-line-soft pb-4"
            description={<>The one password for your candidates&apos; accounts on job sites. Apply fills it on sign-in and create-account pages (with the candidate&apos;s email); you click Sign in or Create account yourself.</>}
            icon={<LockKeyhole />}
            title="Site account password"
          />
          <SiteAccountPasswordForm saved={Boolean(siteAccount?.password)} />
        </Card>
      )}

      {user.role === "manager" && (
        <Card>
          <CardHeader
            className="mb-6 border-b border-line-soft pb-4"
            description={<>A Gmail made only for QTS (not your everyday mail). Your candidates&apos; mailboxes forward code mails to it; when a job site asks for a code or a link sent by email, Apply reads it from here, types the code or opens the link. QTS keeps no mail.</>}
            icon={<MailCheck />}
            title="Verification mailbox"
          />
          <VerificationMailboxForm address={siteAccount?.mailAddress ?? null} host={siteAccount?.mailHost ?? null} />
        </Card>
      )}
    </main>
  );
}
