"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  minimumPasswordLength,
  passwordLengthError,
} from "@/lib/password-policy";
import { createSession, requireUser } from "@/lib/session";
import {
  SITE_ACCOUNT_PASSWORD_MAX,
  encryptSiteAccountPassword,
} from "@/server/apply/site-account-password";
import {
  VERIFICATION_MAIL_PASSWORD_MAX,
  checkMailbox,
  cleanAppPassword,
  defaultImapHost,
  isValidImapHost,
  sealMailboxPassword,
} from "@/server/apply/verification-mailbox";

export type ProfileState = {
  error: string | null;
  success: string | null;
};

export async function updateProfileAction(
  _previousState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const actor = await requireUser();
  const displayName = readText(formData, "displayName", 120);
  const loginName = readText(formData, "loginName", 128);
  const currentPassword = readSecret(formData, "currentPassword");
  const newPassword = readSecret(formData, "newPassword");
  const confirmPassword = readSecret(formData, "confirmPassword");

  if (!displayName || !loginName || !currentPassword) {
    return { error: "Complete the required fields.", success: null };
  }

  if (newPassword !== confirmPassword) {
    return { error: "The new passwords do not match.", success: null };
  }

  if (newPassword && newPassword.length < minimumPasswordLength) {
    return {
      error: passwordLengthError("A new password"),
      success: null,
    };
  }

  const [account] = await db
    .select({ passwordHash: users.passwordHash, authVersion: users.authVersion })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  if (!account?.passwordHash) redirect("/login");
  if (!(await verifyPassword(currentPassword, account.passwordHash))) {
    return { error: "The current password is incorrect.", success: null };
  }

  const passwordHash = newPassword ? await hashPassword(newPassword) : undefined;

  try {
    await db
      .update(users)
      .set({
        displayName,
        loginName,
        ...(passwordHash ? { passwordHash } : {}),
        ...(passwordHash ? { authVersion: sql`${users.authVersion} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, actor.id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        error: "That login name is already in use.",
        success: null,
      };
    }
    logCredentialFailure("updating own credentials", error);
    return {
      error: "Credentials could not be updated. Please try again.",
      success: null,
    };
  }

  if (passwordHash) {
    await createSession({
      ...actor,
      authVersion: account.authVersion + 1,
      displayName,
      loginName,
    });
  }

  revalidatePath("/");
  revalidatePath("/profile");
  return {
    error: null,
    success: passwordHash
      ? "Your profile and password were updated."
      : "Your profile was updated.",
  };
}

/**
 * A Manager's one password for the candidates' accounts on job sites (the same for every account):
 * saved encrypted, filled by Apply on sign-in and registration pages. Remove clears it.
 */
export async function saveSiteAccountPasswordAction(
  _previousState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { error: "Only Managers keep a site account password.", success: null };
  const remove = formData.get("intent") === "remove";
  const password = readSecret(formData, "siteAccountPassword");
  const confirm = readSecret(formData, "confirmSiteAccountPassword");
  if (!remove) {
    if (!password) return { error: "Type the password.", success: null };
    if (password.length < minimumPasswordLength) return { error: passwordLengthError("The password"), success: null };
    if (password.length > SITE_ACCOUNT_PASSWORD_MAX) {
      return { error: `Use at most ${SITE_ACCOUNT_PASSWORD_MAX} characters.`, success: null };
    }
    if (password !== confirm) return { error: "The passwords do not match.", success: null };
  }
  try {
    await db
      .update(users)
      .set({ siteAccountPassword: remove ? null : encryptSiteAccountPassword(password), updatedAt: new Date() })
      .where(eq(users.id, actor.id));
  } catch (error) {
    logCredentialFailure("saving the site account password", error);
    return { error: "The password could not be saved. Please try again.", success: null };
  }
  revalidatePath("/profile");
  return { error: null, success: remove ? "The site account password was removed." : "The site account password was saved." };
}

function readText(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= maxLength
    ? value.trim()
    : "";
}

function readSecret(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= 1024 ? value : "";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function logCredentialFailure(stage: string, error: unknown): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`Credential update failed while ${stage} (code: ${code}).`);
}

/**
 * A Manager's verification mailbox (a Gmail made only for QTS): the candidates' mailboxes forward
 * code mails to it, and Apply reads codes and links from it. Saved only after a working login;
 * the app password is encrypted and never shown again. Remove clears all three.
 */
export async function saveVerificationMailboxAction(
  _previousState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { error: "Only Managers keep a verification mailbox.", success: null };
  if (formData.get("intent") === "remove") {
    try {
      await db
        .update(users)
        .set({ verificationMailAddress: null, verificationMailHost: null, verificationMailPassword: null, updatedAt: new Date() })
        .where(eq(users.id, actor.id));
    } catch (error) {
      logCredentialFailure("removing the verification mailbox", error);
      return { error: "The mailbox could not be removed. Please try again.", success: null };
    }
    revalidatePath("/profile");
    return { error: null, success: "The verification mailbox was removed. Apply asks you for codes again." };
  }
  const address = readText(formData, "verificationMailAddress", 254).toLowerCase();
  const password = cleanAppPassword(readSecret(formData, "verificationMailPassword"));
  const host = (readText(formData, "verificationMailHost", 253).toLowerCase() || defaultImapHost(address));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { error: "Type the mailbox's email address.", success: null };
  if (!password) return { error: "Type the mailbox's app password.", success: null };
  if (password.length > VERIFICATION_MAIL_PASSWORD_MAX) return { error: "That app password is too long.", success: null };
  if (!isValidImapHost(host)) return { error: "Type a valid IMAP server (for Gmail: imap.gmail.com).", success: null };
  const checked = await checkMailbox({ address, host, password });
  if (!checked.ok) return { error: checked.reason, success: null };
  try {
    await db
      .update(users)
      .set({
        verificationMailAddress: address,
        verificationMailHost: host,
        verificationMailPassword: sealMailboxPassword(password),
        updatedAt: new Date(),
      })
      .where(eq(users.id, actor.id));
  } catch (error) {
    logCredentialFailure("saving the verification mailbox", error);
    return { error: "The mailbox could not be saved. Please try again.", success: null };
  }
  revalidatePath("/profile");
  return { error: null, success: "Connected and saved. Apply now reads codes and links sent to your candidates from this mailbox." };
}
