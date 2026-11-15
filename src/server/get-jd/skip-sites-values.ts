// Sites Get JD never reads: no panel, no duplicate check, no AI. Super Admin edits the list in
// Settings (saved in the settings table); these are the sites used until it is first saved.
// Each entry is an exact host ("www." ignored, other subdomains are separate sites, so
// careers.example.com is never caught by example.com) with an optional path start.

export const getJdSkipSitesSettingKey = "get_jd_skip_sites";
export const maxGetJdSkipSites = 300;
const maxSkipSiteLength = 200;

// Sites that also host their own careers pages (slack.com/careers, stripe.com/jobs…) are listed
// only by the paths that are never jobs, so no real job is skipped.
export const defaultGetJdSkipSites: readonly string[] = Object.freeze([
  // Search engines
  "google.com/search", "bing.com/search", "search.yahoo.com", "yandex.com/search", "yandex.ru/search", "baidu.com/s",
  // Email
  "mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yahoo.com", "mail.proton.me",
  // Video and music
  "youtube.com", "m.youtube.com", "netflix.com/browse", "netflix.com/watch", "open.spotify.com",
  // Social
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "pinterest.com", "threads.net",
  // LinkedIn pages that are not job postings
  "linkedin.com/feed", "linkedin.com/in/", "linkedin.com/messaging", "linkedin.com/notifications", "linkedin.com/mynetwork",
  // Chat and meetings
  "web.whatsapp.com", "web.telegram.org", "discord.com/channels", "app.slack.com", "teams.microsoft.com", "teams.live.com", "zoom.us/j/", "meet.google.com",
  // Work tools
  "drive.google.com", "calendar.google.com", "github.com", "gitlab.com", "figma.com/file", "figma.com/design", "canva.com/design",
  // AI tools
  "chatgpt.com", "chat.openai.com", "gemini.google.com", "claude.ai", "perplexity.ai/search", "copilot.microsoft.com",
  // Shopping and reference
  "aliexpress.com", "wikipedia.org", "en.wikipedia.org", "stackoverflow.com/questions", "translate.google.com",
  // News
  "bbc.com/news", "bbc.co.uk/news", "cnn.com", "nytimes.com", "theguardian.com", "reuters.com", "bloomberg.com/news", "forbes.com", "medium.com",
  // Payments
  "paypal.com/myaccount", "dashboard.stripe.com",
]);

/** "https://www.Example.com/a/?q" → "example.com/a/"; null when it is not a usable entry. */
export function normalizeGetJdSkipSite(value: unknown): string | null {
  let text = String(value ?? "").trim().toLowerCase();
  if (!text || /[\s\u0000-\u001f\u007f]/.test(text)) return null;
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "");
  if (!text || text.length > maxSkipSiteLength) return null;
  const slash = text.indexOf("/");
  const host = slash < 0 ? text : text.slice(0, slash);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return text;
}

/** The list from the Settings text box: one site per line. Blank lines and repeats are dropped. */
export function parseGetJdSkipSites(text: string): { sites: string[] } | { error: string } {
  const sites: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const site = normalizeGetJdSkipSite(line);
    if (!site) return { error: `"${line.trim().slice(0, 80)}" is not a site. Enter one site per line, such as youtube.com or linkedin.com/feed.` };
    if (!sites.includes(site)) sites.push(site);
  }
  if (sites.length > maxGetJdSkipSites) return { error: `At most ${maxGetJdSkipSites} sites can be listed.` };
  return { sites };
}

/** A saved settings value as a clean list; anything else is treated as "not saved yet". */
export function readSavedGetJdSkipSites(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(normalizeGetJdSkipSite).filter((site): site is string => site !== null).slice(0, maxGetJdSkipSites);
}
