import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";

const sessionCookieName = "qts_session";
const sessionDurationSeconds = 60 * 60 * 24 * 7;

export type StaffSession = {
  id: string;
  role: "super_admin" | "admin" | "manager";
  displayName: string;
  loginName: string;
  authVersion: number;
};

function isStaffRole(role: unknown): role is StaffSession["role"] {
  return role === "super_admin" || role === "admin" || role === "manager";
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(user: StaffSession): Promise<void> {
  const token = await new SignJWT({
    role: user.role,
    displayName: user.displayName,
    loginName: user.loginName,
    authVersion: user.authVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${sessionDurationSeconds}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDurationSeconds,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
}

export async function getCurrentUser(): Promise<StaffSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (!token) return null;

  const secret = getSecret();
  let subject: string;
  let role: StaffSession["role"];
  let authVersion: number;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      !isStaffRole(payload.role) ||
      typeof payload.authVersion !== "number"
    ) {
      return null;
    }
    subject = payload.sub;
    role = payload.role;
    authVersion = payload.authVersion;
  } catch {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      displayName: users.displayName,
      loginName: users.loginName,
      authVersion: users.authVersion,
    })
    .from(users)
    .where(
      and(
        eq(users.id, subject),
        eq(users.role, role),
        eq(users.authVersion, authVersion),
        isNull(users.blockedAt),
      ),
    )
    .limit(1);

  if (!user || !user.displayName || !user.loginName) return null;

  return {
    id: user.id,
    role,
    displayName: user.displayName,
    loginName: user.loginName,
    authVersion: user.authVersion,
  };
}

export async function requireUser(): Promise<StaffSession> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
