import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { loginHistory, users } from "@/db/schema";
import { createExtensionToken } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  performDummyPasswordCheck,
  verifyPassword,
} from "@/lib/password";

const invalidCredentials = {
  success: false,
  message: "The login name or password is incorrect.",
};

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(invalidCredentials, 400);
  }

  const loginName =
    typeof body === "object" && body !== null && "loginName" in body
      ? body.loginName
      : null;
  const password =
    typeof body === "object" && body !== null && "password" in body
      ? body.password
      : null;
  if (
    typeof loginName !== "string" ||
    typeof password !== "string" ||
    loginName.length > 128 ||
    password.length > 1024 ||
    !loginName.trim() ||
    !password
  ) {
    return jsonResponse(invalidCredentials, 400);
  }

  let manager;
  try {
    [manager] = await db
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
          sql`lower(btrim(${users.loginName})) = ${loginName.trim().toLowerCase()}`,
          eq(users.role, "manager"),
          sql`${users.blockedAt} is null`,
        ),
      )
      .limit(1);
  } catch (error) {
    logExtensionLoginFailure("looking up a Manager account", error);
    throw error;
  }

  if (!manager?.passwordHash || !manager.loginName || !manager.displayName) {
    await performDummyPasswordCheck(password);
    return jsonResponse(invalidCredentials, 401);
  }

  if (!(await verifyPassword(password, manager.passwordHash))) {
    return jsonResponse(invalidCredentials, 401);
  }

  try {
    const sessionUser = {
      id: manager.id,
      role: "manager" as const,
      displayName: manager.displayName,
      loginName: manager.loginName,
      authVersion: manager.authVersion,
    };
    const { token, expiresAt } = await createExtensionToken(sessionUser);
    await db.insert(loginHistory).values({ userId: manager.id });
    await db
      .delete(loginHistory)
      .where(
        and(
          eq(loginHistory.userId, manager.id),
          notInArray(
            loginHistory.id,
            db
              .select({ id: loginHistory.id })
              .from(loginHistory)
              .where(eq(loginHistory.userId, manager.id))
              .orderBy(desc(loginHistory.loggedInAt), desc(loginHistory.id))
              .limit(5),
          ),
        ),
      );

    return jsonResponse({
      success: true,
      token,
      expiresAt,
      id: manager.id,
      username: manager.loginName,
      name: manager.displayName,
      role: "manager",
    });
  } catch (error) {
    logExtensionLoginFailure("creating an extension session", error);
    throw error;
  }
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function logExtensionLoginFailure(stage: string, error: unknown): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`Extension login failed while ${stage} (code: ${code}).`);
}
