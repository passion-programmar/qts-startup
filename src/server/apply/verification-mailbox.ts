import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { openSecret, sealSecret } from "./site-account-password";
import { pickVerification, type VerificationFound, type VerificationMail } from "./verification-mail-extract";

// The Manager's verification mailbox, read over IMAP from the server only. One connection per
// request, closed at the end; it looks for new mail every few seconds while it waits (waiting costs
// almost no CPU). Nothing from a mail is stored: the one used is only marked read in the mailbox.

const PURPOSE = "qts-verification-mailbox";
export const VERIFICATION_MAIL_PASSWORD_MAX = 256;

export type MailboxLogin = { address: string; host: string; password: string };

export const sealMailboxPassword = (password: string) => sealSecret(PURPOSE, password);
export const openMailboxPassword = (stored: string | null | undefined) => openSecret(PURPOSE, stored);

/** The usual IMAP server for an address ("imap.gmail.com" for Gmail). */
export function defaultImapHost(address: string): string {
  const domain = address.split("@")[1]?.trim().toLowerCase() || "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "imap.gmail.com";
  if (domain === "gmx.com" || domain === "gmx.us") return "imap.gmx.com";
  if (/^gmx\.[a-z.]+$/.test(domain)) return "imap.gmx.net";
  if (/^(yahoo|ymail)\.[a-z.]+$/.test(domain)) return "imap.mail.yahoo.com";
  return domain ? `imap.${domain}` : "";
}

/** An app password as Google shows it ("abcd efgh ijkl mnop"): spaces removed. */
// Copied from Google's page it can also carry invisible characters (zero-width spaces): removed too.
export const cleanAppPassword = (value: string) => value.replace(/[\s​-‍⁠﻿]+/g, "");

const VALID_HOST = /^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export const isValidImapHost = (host: string) => VALID_HOST.test(host);

export type MailboxClient = Pick<ImapFlow, "connect" | "logout" | "close" | "on" | "list" | "getMailboxLock" | "search" | "fetchAll" | "fetchOne" | "messageFlagsAdd">;

function client(login: MailboxLogin): MailboxClient {
  return new ImapFlow({
    host: login.host,
    port: 993,
    secure: true,
    auth: { user: login.address, pass: login.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
}

/** Why a login did not work, in words for the Manager (never the password). */
function mailboxProblem(error: unknown): string {
  const failure = error as { authenticationFailed?: boolean; code?: string; response?: unknown; responseText?: string; serverResponseCode?: string; message?: string } | null;
  // The mail server's own words ("Invalid credentials", "Please log in via your web browser"): never
  // the password, which the server does not repeat. imapflow keeps them in `response`.
  const reply = typeof failure?.response === "string" ? failure.response : failure?.responseText || "";
  const said = [failure?.serverResponseCode, reply].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
  const server = said ? ` The mail server said: "${said}".` : "";
  if (failure?.authenticationFailed) {
    return `The mailbox refused the login: check the address and the app password (Gmail needs 2-Step Verification and an app password, not the normal password).${server}`;
  }
  if (failure?.code === "ENOTFOUND" || failure?.code === "EAI_AGAIN") return "The mail server name was not found. Check the IMAP server.";
  if (failure?.code === "ETIMEDOUT" || failure?.code === "ECONNREFUSED" || failure?.code === "ECONNRESET") {
    return "The mail server did not answer. Check the IMAP server, or try again.";
  }
  return `QTS could not open the mailbox. Check the address, the app password and the IMAP server.${server}`;
}

/** One login and logout: { ok } or why not. */
export async function checkMailbox(login: MailboxLogin): Promise<{ ok: true } | { ok: false; reason: string }> {
  const imap = client(login);
  imap.on("error", () => {});
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    lock.release();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: mailboxProblem(error) };
  } finally {
    await imap.logout().catch(() => imap.close());
  }
}

const addressesOf = (value: AddressObject | AddressObject[] | undefined): string[] =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) => group.value.map((entry) => entry.address || "")).filter(Boolean);

function headerAddresses(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
  if (Array.isArray(value)) return value.flatMap(headerAddresses);
  if (typeof value === "object" && "value" in (value as object)) return addressesOf(value as AddressObject);
  return [];
}

async function readMail(uid: number, source: Buffer, receivedAt: Date): Promise<VerificationMail> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = parsed.from?.value[0];
  const recipients = [
    ...addressesOf(parsed.to),
    ...addressesOf(parsed.cc),
    ...["delivered-to", "x-original-to", "x-forwarded-to", "x-forwarded-for"].flatMap((name) => headerAddresses(parsed.headers.get(name))),
  ];
  return {
    uid,
    receivedAt,
    fromAddress: from?.address || "",
    fromName: from?.name || "",
    recipients,
    subject: parsed.subject || "",
    text: parsed.text || "",
    html: typeof parsed.html === "string" ? parsed.html : "",
  };
}

export type VerificationWait =
  | { status: "found"; code: string | null; link: string | null; fromSite: boolean }
  | { status: "not_yet" }
  | { status: "mailbox_error"; message: string };

const MAX_MAIL_BYTES = 400_000;
const LOOK_EVERY_MS = 4_000;

/**
 * Waits (up to waitMs) for the candidate's verification mail that arrived after `since`, in the
 * inbox and the spam folder. The mail used is marked read; the rest is left as it was.
 */
export async function waitForVerificationMail(
  login: MailboxLogin,
  { candidateEmail, tokens, since, waitMs, exclude }: { candidateEmail: string; tokens: string[]; since: Date; waitMs: number; exclude: string[] },
  // Tests hand in a fake mailbox; the server always uses a real IMAP connection.
  makeClient: (login: MailboxLogin) => MailboxClient = client,
): Promise<VerificationWait> {
  const imap = makeClient(login);
  imap.on("error", () => {});
  const deadline = Date.now() + waitMs;
  // Mails already read in an earlier round (no code, another candidate): not downloaded again.
  const looked = new Set<string>();
  const mails: (VerificationMail & { folder: string; mailboxUid: number })[] = [];
  try {
    await imap.connect();
    const folders = await imap.list().catch(() => []);
    const spam = folders.find((folder) => folder.specialUse === "\\Junk")?.path;
    const paths = ["INBOX", ...(spam ? [spam] : [])];
    const dayBefore = new Date(since.getTime() - 24 * 60 * 60 * 1000);
    for (;;) {
      for (const path of paths) {
        const lock = await imap.getMailboxLock(path);
        try {
          const uids = await imap.search({ since: dayBefore }, { uid: true });
          const recent = (uids || []).slice(-40).filter((uid) => !looked.has(`${path}:${uid}`));
          if (!recent.length) continue;
          const heads = await imap.fetchAll(recent.join(","), { uid: true, internalDate: true, size: true }, { uid: true });
          for (const head of heads) {
            const receivedAt = head.internalDate ? new Date(head.internalDate) : null;
            if (!receivedAt || receivedAt < since || (head.size ?? 0) > MAX_MAIL_BYTES) {
              looked.add(`${path}:${head.uid}`);
              continue;
            }
            const full = await imap.fetchOne(String(head.uid), { uid: true, source: true }, { uid: true });
            looked.add(`${path}:${head.uid}`);
            // Numbered by QTS (the inbox and the spam folder each count their own UIDs from 1).
            if (full && full.source) mails.push({ ...(await readMail(mails.length + 1, full.source, receivedAt)), folder: path, mailboxUid: head.uid });
          }
        } finally {
          lock.release();
        }
      }
      const found: VerificationFound | null = pickVerification(mails, { candidateEmail, tokens, exclude });
      if (found) {
        const used = mails.find((entry) => entry.uid === found.uid);
        if (used) {
          const lock = await imap.getMailboxLock(used.folder);
          try { await imap.messageFlagsAdd(String(used.mailboxUid), ["\\Seen"], { uid: true }); } catch { /* read or not, the code is used */ } finally { lock.release(); }
        }
        return { status: "found", code: found.code, link: found.link, fromSite: found.fromSite };
      }
      if (Date.now() + LOOK_EVERY_MS >= deadline) return { status: "not_yet" };
      await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY_MS));
    }
  } catch (error) {
    return { status: "mailbox_error", message: mailboxProblem(error) };
  } finally {
    await imap.logout().catch(() => imap.close());
  }
}

/** The saved mailbox as a login, or null when none is saved or its password cannot be read. */
export function mailboxLogin(row: { address: string | null; host: string | null; password: string | null }): MailboxLogin | null {
  const password = openMailboxPassword(row.password);
  if (!row.address || !password) return null;
  return { address: row.address, host: row.host || defaultImapHost(row.address), password };
}
