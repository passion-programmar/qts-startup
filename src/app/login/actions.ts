"use server";

import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { loginHistory, users } from "@/db/schema";
import { db } from "@/lib/db";
import {
  performDummyPasswordCheck,
  verifyPassword,
} from "@/lib/password";
import { clearSession, createSession } from "@/lib/session";

export type LoginState = {
  error: string | null;
};

const allowedRoles = ["super_admin", "admin", "manager"] as const;
const invalidCredentials: LoginState = {
  error: "The login name or password is incorrect.",
};

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const rawLoginName = formData.get("loginName");
  const password = formData.get("password");

  if (
    typeof rawLoginName !== "string" ||
    typeof password !== "string" ||
    rawLoginName.length > 128 ||
    password.length > 1024 ||
    !rawLoginName.trim() ||
    !password
  ) {
    return invalidCredentials;
  }

  const normalizedLoginName = rawLoginName.trim().toLowerCase();
  let stage = "looking up staff account";
  let user;
  try {
    [user] = await db
      .select({
        id: users.id,
        role: users.role,
        displayName: users.displayName,
        loginName: users.loginName,
        passwordHash: users.passwordHash,
        authVersion: users.authVersion,
      })
      .from(users)
      .where(
        and(
          sql`lower(btrim(${users.loginName})) = ${normalizedLoginName}`,
          inArray(users.role, allowedRoles),
          sql`${users.blockedAt} is null`,
        ),
      )
      .limit(1);
  } catch (error) {
    logLoginFailure(stage, error);
    throw error;
  }

  if (!user?.passwordHash || !user.loginName || !user.displayName) {
    await performDummyPasswordCheck(password);
    return invalidCredentials;
  }

  if (user.role === "account") return invalidCredentials;

  if (!(await verifyPassword(password, user.passwordHash))) {
    return invalidCredentials;
  }

  stage = "creating session";
  try {
    await createSession({
      id: user.id,
      role: user.role,
      displayName: user.displayName,
      loginName: user.loginName,
      authVersion: user.authVersion,
    });
  } catch (error) {
    logLoginFailure(stage, error);
    throw error;
  }

  stage = "recording successful login";
  try {
    await db.insert(loginHistory).values({ userId: user.id });
    await db
      .delete(loginHistory)
      .where(
        and(
          eq(loginHistory.userId, user.id),
          notInArray(
            loginHistory.id,
            db
              .select({ id: loginHistory.id })
              .from(loginHistory)
              .where(eq(loginHistory.userId, user.id))
              .orderBy(desc(loginHistory.loggedInAt), desc(loginHistory.id))
              .limit(5),
          ),
        ),
      );
  } catch (error) {
    await clearSession();
    logLoginFailure(stage, error);
    throw error;
  }

  redirect("/");
}

function logLoginFailure(stage: string, error: unknown): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`Login action failed while ${stage} (code: ${code}).`);
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
