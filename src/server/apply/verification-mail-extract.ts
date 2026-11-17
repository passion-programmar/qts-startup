// Finding a job site's verification code or link in a mail the candidate's mailbox forwarded to the
// Manager's verification mailbox. Rules only: the mail must be addressed to the candidate, and it
// counts as the job site's when the sender, its name or the subject names the site or the company.
// Nothing here talks to a mailbox (src/server/apply/verification-mailbox.ts does).

export type VerificationMail = {
  /** The mailbox's own number for the mail (IMAP UID), to mark it read once used. */
  uid: number;
  receivedAt: Date;
  fromAddress: string;
  fromName: string;
  /** To, Cc, Delivered-To, X-Original-To and X-Forwarded-To addresses, as found. */
  recipients: string[];
  subject: string;
  text: string;
  html: string;
};

export type VerificationFound = {
  uid: number;
  code: string | null;
  link: string | null;
  /** The sender named the job site or the company (otherwise only a lone code is trusted). */
  fromSite: boolean;
};

// Words that say nothing about which site a host or a company is.
const GENERIC = new Set([
  "www", "com", "net", "org", "info", "biz", "io", "co", "ai", "app", "apps", "dev", "jobs", "job", "careers", "career",
  "apply", "applicant", "applicants", "mail", "email", "emails", "noreply", "reply", "notifications", "notification",
  "notify", "talent", "recruiting", "recruitment", "recruit", "boards", "board", "hire", "hiring", "work", "team",
  "global", "group", "inc", "ltd", "llc", "gmbh", "limited", "company", "corp", "corporation", "the", "and", "services",
  "service", "solutions", "systems", "technologies", "technology", "international", "europe", "portal", "secure", "account",
  "accounts", "login", "auth", "support", "help", "online", "site", "sites", "cloud", "web", "http", "https",
]);

const words = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/** The distinctive words of the job's addresses and the company name ("greenhouse", "acme"). */
export function siteTokens(urls: string[], company: string): string[] {
  const found = new Set<string>();
  for (const url of urls) {
    let host = "";
    try { host = new URL(url).hostname; } catch { continue; }
    for (const word of words(host)) if (word.length >= 4 && !GENERIC.has(word)) found.add(word);
  }
  for (const word of words(company)) if (word.length >= 4 && !GENERIC.has(word)) found.add(word);
  return [...found];
}

/** Whether the mail's sender, sender name or subject names one of the site's words. */
export function fromJobSite(mail: Pick<VerificationMail, "fromAddress" | "fromName" | "subject">, tokens: string[]): boolean {
  const said = `${mail.fromAddress} ${mail.fromName} ${mail.subject}`.toLowerCase();
  return tokens.some((token) => said.includes(token));
}

export function addressedTo(mail: Pick<VerificationMail, "recipients">, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return Boolean(wanted) && mail.recipients.some((address) => address.trim().toLowerCase() === wanted);
}

const CODE_WORDS = /\b(codes?|verification|verify|one[- ]?time|otp|pass ?code|pin|security code|confirmation code|access code|login code)\b/gi;
// 4-8 letters and digits with at least one digit, or "123 456" / "123-456".
const CODE_SHAPE = /(?<![\w@./-])(\d{3}[ -]\d{3}|(?=[A-Za-z]*\d)[A-Za-z0-9]{4,8})(?![\w@/-]|\.\w)/g;

/** Plain words of an HTML mail (only when it has no plain-text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ");
}

/** The code a mail gives: a 4-8 character code near the words "code", "verification", "one-time"… */
export function findCode(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ");
  const keywordAt: number[] = [];
  for (const match of text.matchAll(CODE_WORDS)) keywordAt.push(match.index ?? 0);
  if (!keywordAt.length) return null;
  const year = new Date().getFullYear();
  let best: { code: string; score: number } | null = null;
  for (const match of text.matchAll(CODE_SHAPE)) {
    const raw = match[1];
    const code = raw.replace(/[ -]/g, "");
    if (/^\d{4}$/.test(code) && Math.abs(Number(code) - year) <= 30) continue;
    const at = match.index ?? 0;
    const distance = Math.min(...keywordAt.map((position) => (position <= at ? at - position : (position - at) * 2)));
    if (distance > 160) continue;
    const score = distance + (code.length === 6 ? 0 : 25);
    if (!best || score < best.score) best = { code, score };
  }
  return best?.code ?? null;
}

const LINK_WORDS = /verif|confirm|activat|validat|complete (your )?(registration|sign ?up)|sign ?in|log ?in|magic|continue/i;

/** The verify / confirm link, only one that goes to the job site or the company. */
export function findLink(html: string, text: string, tokens: string[]): string | null {
  const links: { href: string; label: string }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    links.push({ href: match[1].replace(/&amp;/g, "&"), label: htmlToText(match[2]).trim() });
  }
  for (const match of text.matchAll(/https:\/\/[^\s<>"')\]]+/gi)) links.push({ href: match[0], label: "" });
  for (const link of links) {
    let url: URL;
    try { url = new URL(link.href); } catch { continue; }
    if (url.protocol !== "https:") continue;
    if (!LINK_WORDS.test(`${link.label} ${url.pathname} ${url.search}`)) continue;
    const host = url.hostname.toLowerCase();
    if (tokens.some((token) => host.includes(token))) return url.toString();
  }
  return null;
}

/**
 * The mail to use, newest first: addressed to the candidate, from the job site, with a code or a
 * link. Failing that, a code from the only fresh mail to the candidate that has one (a code typed
 * in the wrong place does no harm; a link from an unknown sender is never used).
 */
export function pickVerification(
  mails: VerificationMail[],
  { candidateEmail, tokens, exclude = [] }: { candidateEmail: string; tokens: string[]; exclude?: string[] },
): VerificationFound | null {
  const used = new Set(exclude);
  const mine = mails.filter((mail) => addressedTo(mail, candidateEmail)).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  const read = mine.map((mail) => {
    const body = mail.text || htmlToText(mail.html);
    const code = findCode(mail.subject, body);
    const link = findLink(mail.html, mail.text, tokens);
    return { mail, code: code && !used.has(code) ? code : null, link: link && !used.has(link) ? link : null };
  });
  const fromSite = read.find((entry) => fromJobSite(entry.mail, tokens) && (entry.code || entry.link));
  if (fromSite) return { uid: fromSite.mail.uid, code: fromSite.code, link: fromSite.link, fromSite: true };
  const withCode = read.filter((entry) => entry.code);
  if (withCode.length === 1) return { uid: withCode[0].mail.uid, code: withCode[0].code, link: null, fromSite: false };
  return null;
}
