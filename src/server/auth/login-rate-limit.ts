import "server-only";

import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { loginRateLimitEvents } from "@/db/schema";
import { db } from "@/lib/db";

const loginRateLimit = {
  identityAttempts: 10,
  networkAttempts: 50,
  windowSeconds: 15 * 60,
} as const;

type LoginHeaders = Pick<Headers, "get">;

export async function consumeLoginAttempt(
  loginName: string,
  requestHeaders: LoginHeaders,
): Promise<boolean> {
  const [identityKey, networkKey] = getRateLimitKeys(loginName, requestHeaders);
  const identityAllowed = await consumeKey(
    identityKey,
    loginRateLimit.identityAttempts,
  );
  if (!identityAllowed) return false;
  return consumeKey(networkKey, loginRateLimit.networkAttempts);
}

export async function clearLoginAttempts(
  loginName: string,
  requestHeaders: LoginHeaders,
): Promise<void> {
  const [identityKey] = getRateLimitKeys(loginName, requestHeaders);
  await db
    .delete(loginRateLimitEvents)
    .where(eq(loginRateLimitEvents.keyHash, identityKey));
}

async function consumeKey(keyHash: string, maximumAttempts: number): Promise<boolean> {
  const result = await db.execute<{ allowed: boolean }>(sql`
    select consume_login_rate_limit(
      ${keyHash},
      ${maximumAttempts},
      ${loginRateLimit.windowSeconds}
    ) as allowed
  `);
  return result.rows[0]?.allowed === true;
}

function getRateLimitKeys(
  loginName: string,
  requestHeaders: LoginHeaders,
): [string, string] {
  const normalizedLoginName = loginName.trim().toLowerCase();
  const clientAddress = getClientAddress(requestHeaders);
  return [
    hashRateLimitKey(`identity:${clientAddress}:${normalizedLoginName}`),
    hashRateLimitKey(`network:${clientAddress}`),
  ];
}

function getClientAddress(requestHeaders: LoginHeaders): string {
  const realAddress = requestHeaders.get("x-real-ip")?.trim();
  if (realAddress) return realAddress.slice(0, 128);
  const forwardedAddress = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwardedAddress?.slice(0, 128) || "unknown";
}

function hashRateLimitKey(value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for login rate limiting.");
  return createHmac("sha256", secret).update(value).digest("hex");
}
