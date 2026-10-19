import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";

const extensionTokenLifetimeSeconds = 60 * 60 * 24;
const extensionTokenIssuer = "qts-job-system";
const extensionTokenAudience = "qts-browser-extension";

export type ExtensionManager = {
  id: string;
  role: "manager";
  displayName: string;
  loginName: string;
  authVersion: number;
};

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

export async function createExtensionToken(
  manager: ExtensionManager,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = now + extensionTokenLifetimeSeconds;
  const token = await new SignJWT({
    role: manager.role,
    authVersion: manager.authVersion,
    tokenType: "extension_access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(extensionTokenIssuer)
    .setAudience(extensionTokenAudience)
    .setSubject(manager.id)
    .setIssuedAt(now)
    .setExpirationTime(expiresAtSeconds)
    .sign(getAuthSecret());

  return { token, expiresAt: expiresAtSeconds * 1000 };
}

export async function getExtensionManager(
  request: Request,
): Promise<ExtensionManager | null> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  let managerId: string;
  let authVersion: number;
  try {
    const { payload } = await jwtVerify(match[1], getAuthSecret(), {
      algorithms: ["HS256"],
      issuer: extensionTokenIssuer,
      audience: extensionTokenAudience,
    });
    if (
      typeof payload.sub !== "string" ||
      payload.role !== "manager" ||
      payload.tokenType !== "extension_access" ||
      typeof payload.authVersion !== "number"
    ) {
      return null;
    }
    managerId = payload.sub;
    authVersion = payload.authVersion;
  } catch {
    return null;
  }

  const [manager] = await db
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
        eq(users.id, managerId),
        eq(users.role, "manager"),
        eq(users.authVersion, authVersion),
        isNull(users.blockedAt),
      ),
    )
    .limit(1);

  if (!manager?.displayName || !manager.loginName) return null;
  return {
    id: manager.id,
    role: "manager",
    displayName: manager.displayName,
    loginName: manager.loginName,
    authVersion: manager.authVersion,
  };
}
