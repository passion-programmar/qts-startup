import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type { MailboxClient } from "./verification-mailbox";

// The verification mailbox's wait against a fake mailbox (no real Gmail): only fresh mail counts,
// the spam folder is read too, a mail that arrives while it waits is found, and the mail used is
// marked read. The mails are real RFC 822 text, so the real mail parser reads them.

function loadMailbox() {
  // Next resolves "server-only" to an empty module for server code; do the same here.
  const require = Module.createRequire(__filename);
  const serverOnly = require.resolve("server-only");
  require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  process.env.AUTH_SECRET ||= "test-secret-test-secret-test-secret-0123";
  return require("./verification-mailbox") as typeof import("./verification-mailbox");
}

const rfc822 = ({ from, to, subject, body }: { from: string; to: string; subject: string; body: string }) => Buffer.from([
  `From: ${from}`,
  `To: ${to}`,
  `Subject: ${subject}`,
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  body,
  "",
].join("\r\n"));

type FakeMail = { uid: number; internalDate: Date; source: Buffer };

function fakeMailbox(folders: Record<string, FakeMail[]>) {
  const flagged: string[] = [];
  let open = "";
  const fake = {
    on: () => fake,
    connect: async () => {},
    logout: async () => {},
    close: () => {},
    list: async () => Object.keys(folders).map((path) => ({ path, specialUse: path.includes("Spam") ? "\\Junk" : undefined })),
    getMailboxLock: async (path: string) => { open = path; return { path, release: () => {} }; },
    search: async () => folders[open].map((mail) => mail.uid),
    fetchAll: async (range: string) => {
      const wanted = new Set(String(range).split(",").map(Number));
      return folders[open].filter((mail) => wanted.has(mail.uid)).map((mail) => ({ uid: mail.uid, seq: mail.uid, internalDate: mail.internalDate, size: mail.source.length }));
    },
    fetchOne: async (uid: string) => {
      const mail = folders[open].find((entry) => entry.uid === Number(uid));
      return mail ? { uid: mail.uid, seq: mail.uid, source: mail.source } : false;
    },
    messageFlagsAdd: async (uid: string, flags: string[]) => { flagged.push(`${open}:${uid}:${flags.join(",")}`); return true; },
  };
  return { client: fake as unknown as MailboxClient, flagged, folders };
}

const login = { address: "mgr.qts@gmail.com", host: "imap.gmail.com", password: "x" };
const since = new Date("2026-11-17T10:00:00Z");
const options = { candidateEmail: "anna@gmail.com", tokens: ["greenhouse", "acme"], since, exclude: [] as string[] };

test("only fresh mail to the candidate counts; the spam folder is read; the mail used is marked read", async () => {
  const { waitForVerificationMail } = loadMailbox();
  const box = fakeMailbox({
    INBOX: [
      { uid: 1, internalDate: new Date("2026-11-17T09:30:00Z"), source: rfc822({ from: "no-reply@greenhouse-mail.io", to: "anna@gmail.com", subject: "Your code", body: "Your verification code is 111111" }) },
      { uid: 2, internalDate: new Date("2026-11-17T10:01:00Z"), source: rfc822({ from: "no-reply@greenhouse-mail.io", to: "ben@gmail.com", subject: "Your code", body: "Your verification code is 222222" }) },
    ],
    "[Gmail]/Spam": [
      { uid: 7, internalDate: new Date("2026-11-17T10:02:00Z"), source: rfc822({ from: "Acme <no-reply@greenhouse-mail.io>", to: "Anna <anna@gmail.com>", subject: "Security code", body: "Copy this code into the security code field: Xy7Kp2Qa" }) },
    ],
  });
  const result = await waitForVerificationMail(login, { ...options, waitMs: 1000 }, () => box.client);
  assert.deepEqual(result, { status: "found", code: "Xy7Kp2Qa", link: null, fromSite: true });
  assert.deepEqual(box.flagged, ["[Gmail]/Spam:7:\\Seen"]);
});

test("a mail that arrives while it waits is found; nothing in time is 'not yet'", async () => {
  const { waitForVerificationMail } = loadMailbox();
  const box = fakeMailbox({ INBOX: [] });
  setTimeout(() => box.folders.INBOX.push({
    uid: 3,
    internalDate: new Date("2026-11-17T10:03:00Z"),
    source: rfc822({ from: "no-reply@greenhouse-mail.io", to: "anna@gmail.com", subject: "Verify your email", body: "Your one-time code: 735019" }),
  }), 1000);
  const found = await waitForVerificationMail(login, { ...options, waitMs: 9000 }, () => box.client);
  assert.deepEqual(found, { status: "found", code: "735019", link: null, fromSite: true });

  const empty = fakeMailbox({ INBOX: [] });
  assert.deepEqual(await waitForVerificationMail(login, { ...options, waitMs: 500 }, () => empty.client), { status: "not_yet" });
});

test("a refused login is reported in words, never with the password", async () => {
  const { waitForVerificationMail } = loadMailbox();
  const refusing = { ...fakeMailbox({ INBOX: [] }).client, connect: async () => { throw Object.assign(new Error("Invalid credentials"), { authenticationFailed: true }); } } as MailboxClient;
  const result = await waitForVerificationMail(login, { ...options, waitMs: 500 }, () => refusing);
  assert.equal(result.status, "mailbox_error");
  assert.match(result.status === "mailbox_error" ? result.message : "", /app password/);
});

test("the IMAP server for an address", () => {
  const { defaultImapHost, cleanAppPassword } = loadMailbox();
  assert.equal(defaultImapHost("Name.QTS@gmail.com"), "imap.gmail.com");
  assert.equal(defaultImapHost("x@gmx.de"), "imap.gmx.net");
  assert.equal(defaultImapHost("x@gmx.com"), "imap.gmx.com");
  assert.equal(cleanAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
});

test("the app password is sealed under its own key", () => {
  const { sealMailboxPassword, openMailboxPassword } = loadMailbox();
  const sealed = sealMailboxPassword("abcdefghijklmnop");
  assert.notEqual(sealed.includes("abcdefghijklmnop"), true);
  assert.equal(openMailboxPassword(sealed), "abcdefghijklmnop");
});
