import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// The Manager's password for the candidates' accounts on job sites: kept encrypted (AES-256-GCM,
// a key derived from AUTH_SECRET), never shown again, and sent only to the Manager's own extension
// with an application it claimed. A changed AUTH_SECRET makes the saved one unreadable: it is set again.

const VERSION = "v1";

function key(secret = process.env.AUTH_SECRET): Buffer {
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  return createHash("sha256").update(`qts-site-account-password:${secret}`).digest();
}

export function encryptSiteAccountPassword(password: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const sealed = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), sealed].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(":");
}

/** The password, or null when none is saved or it cannot be read (another AUTH_SECRET, a damaged value). */
export function decryptSiteAccountPassword(stored: string | null | undefined, secret?: string): string | null {
  const [version, iv, tag, sealed] = String(stored ?? "").split(":");
  if (version !== VERSION || !iv || !tag || sealed === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(sealed, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const SITE_ACCOUNT_PASSWORD_MAX = 128;
