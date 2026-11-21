// The environment variables QTS reads, for the Super Admin's System guide: where each one is set,
// whether the live site needs it, and what it does. No server imports, so a test can check this list
// against the code (every variable the code reads is listed here, and every one listed is read).
//
// The status check below never returns a value: only whether it is set, and for some a safe fact
// about it (how many keys a list holds, the database user's role name, a secret's length).

export type EnvPlace = "vercel" | "local" | "both" | "automatic";
export type EnvNeed = "required" | "optional" | "local" | "automatic" | "unused";

export type EnvVarGuide = {
  name: string;
  // Where the value is typed in: Vercel (Project → Settings → Environment Variables → Production),
  // this PC's .env.local, both, or set by Vercel / Node by themselves.
  place: EnvPlace;
  need: EnvNeed;
  // A secret: mark it Sensitive on Vercel, never paste it in chat, commits or screenshots.
  secret: boolean;
  purpose: string;
  // What to know before changing it.
  note?: string;
  example?: string;
};

export const ENV_VAR_GUIDE: EnvVarGuide[] = [
  {
    name: "DATABASE_URL",
    place: "both",
    need: "required",
    secret: true,
    purpose: "The Neon Postgres connection. Every page, API call and migration uses it.",
    note: "On Vercel it is the qts_runtime user (reads and writes rows only). In .env.local it is the neondb_owner user, used only on this PC for migrations and seeds. Never put the owner on Vercel.",
    example: "postgresql://qts_runtime:…@ep-…-pooler.….neon.tech/neondb?sslmode=require",
  },
  {
    name: "AUTH_SECRET",
    place: "both",
    need: "required",
    secret: true,
    purpose: "Signs sign-in sessions (website and extension) and encrypts the saved job-site passwords and verification mailbox passwords.",
    note: "At least 32 characters. Changing it signs everyone out and makes every saved job-site password and mailbox password unreadable (they must be typed again). Keep the same value in .env.local when running the site locally against the live database.",
    example: "a random string of 32+ characters",
  },
  {
    name: "GEMINI_API_KEYS",
    place: "vercel",
    need: "required",
    secret: true,
    purpose: "Gemini keys, separated by commas, for Get JD checks and Ask AI. Used in random order; no key is used twice until every key has been used.",
    note: "Set them only on Vercel: Gemini and Groq are never called from this PC. Limits per model are set on the Gemini usage page.",
    example: "key1,key2,key3",
  },
  {
    name: "GEMINI_API_KEY",
    place: "vercel",
    need: "optional",
    secret: true,
    purpose: "One Gemini key, used only when GEMINI_API_KEYS is empty.",
  },
  {
    name: "JD_READ_PROMPT_GEMINI_API_KEY_1",
    place: "vercel",
    need: "optional",
    secret: true,
    purpose: "Old name for one Gemini key, still read when the two names above are empty.",
    note: "Prefer GEMINI_API_KEYS; this name can be removed once that is set.",
  },
  {
    name: "GROQ_API_KEYS",
    place: "vercel",
    need: "optional",
    secret: true,
    purpose: "Groq keys, separated by commas: the last fallback when the Gemini models are busy or out of quota.",
    example: "gsk_…,gsk_…",
  },
  {
    name: "NEON_API_KEY",
    place: "vercel",
    need: "optional",
    secret: true,
    purpose: "Lets Database usage read Neon's own account numbers (compute hours, data transfer, branch sizes).",
    note: "Neon console → organization Settings → API keys. A project-scoped key is enough. Only sent to Neon's API.",
  },
  {
    name: "NEON_PROJECT_ID",
    place: "vercel",
    need: "optional",
    secret: false,
    purpose: "The Neon project (or projects, separated by commas) Database usage reads with NEON_API_KEY.",
    note: "Neon console → project → Settings → General.",
  },
  {
    name: "ENABLE_GEMINI_TOKEN_COMPARISON",
    place: "vercel",
    need: "optional",
    secret: false,
    purpose: "Set to true to show the Gemini token calibration tool on Gemini usage (production only).",
    example: "true",
  },
  {
    name: "QTS_ANSWER_IDENTITY_V1",
    place: "vercel",
    need: "optional",
    secret: false,
    purpose: "Matching saved answers by the meaning of a question is on unless this is 0.",
    note: "Leave it unset. Set 0 only to turn the matching off while checking a problem.",
  },
  {
    name: "PDF_CHROME_EXECUTABLE_PATH",
    place: "local",
    need: "local",
    secret: false,
    purpose: "The Chrome or Edge program this PC uses to print résumé PDFs when the website runs locally.",
    note: "Not set on Vercel: Vercel prints with its own bundled Chromium.",
    example: String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  },
  {
    name: "SUPER_ADMIN_DISPLAY_NAME",
    place: "local",
    need: "local",
    secret: false,
    purpose: "Read only by npm run db:seed:super-admin: the Super Admin's shown name.",
  },
  {
    name: "SUPER_ADMIN_LOGIN_NAME",
    place: "local",
    need: "local",
    secret: false,
    purpose: "Read only by npm run db:seed:super-admin: the Super Admin's user name.",
  },
  {
    name: "SUPER_ADMIN_PASSWORD",
    place: "local",
    need: "local",
    secret: true,
    purpose: "Read only by npm run db:seed:super-admin: sets the Super Admin's password.",
    note: "Running the seed again resets the password to this value.",
  },
  {
    name: "VERCEL_TOKEN",
    place: "local",
    need: "local",
    secret: true,
    purpose: "Optional for scripts/verify-production-release.cjs; without it the script uses the Vercel CLI sign-in.",
  },
  {
    name: "QTS_TEST_DATABASE_URL",
    place: "local",
    need: "local",
    secret: true,
    purpose: "Tests only: a separate database for the database tests. Never the live database.",
  },
  {
    name: "QTS_TEST_PGLITE_PATH",
    place: "local",
    need: "local",
    secret: false,
    purpose: "Tests only: where the PGlite test database engine is installed (a local, throwaway database).",
  },
  {
    name: "QTS_MEASURE_RUNS",
    place: "local",
    need: "local",
    secret: false,
    purpose: "scripts/measure-extension-speed.cjs only: how many runs to measure (7 when unset).",
  },
  {
    name: "QTS_MEASURE_VERBOSE",
    place: "local",
    need: "local",
    secret: false,
    purpose: "scripts/measure-extension-speed.cjs only: print each step while measuring.",
  },
  {
    name: "NODE_ENV",
    place: "automatic",
    need: "automatic",
    secret: false,
    purpose: "production on Vercel and after npm run build; development under npm run dev. Sign-in cookies are Secure in production.",
  },
  {
    name: "VERCEL",
    place: "automatic",
    need: "automatic",
    secret: false,
    purpose: "1 when the site runs on Vercel.",
  },
  {
    name: "VERCEL_ENV",
    place: "automatic",
    need: "automatic",
    secret: false,
    purpose: "production on the live site. Some Super Admin tools work only there.",
  },
  {
    name: "VERCEL_GIT_COMMIT_SHA",
    place: "automatic",
    need: "automatic",
    secret: false,
    purpose: "The commit this deployment was built from. Shown at the top of this guide.",
  },
  {
    name: "VERCEL_GIT_COMMIT_REF",
    place: "automatic",
    need: "automatic",
    secret: false,
    purpose: "The branch this deployment was built from (main for the live site).",
  },
  {
    name: "OPENAI_API_KEY",
    place: "local",
    need: "unused",
    secret: true,
    purpose: "Listed in .env.example but read by no code (résumés are written in the ChatGPT website, not with an API key).",
    note: "Safe to remove from .env.example and from Vercel.",
  },
];

// Read by the operating system or a test runner, not by QTS itself: not listed on the page.
export const ENV_NOT_LISTED = new Set(["USERNAME", "NODE_OPTIONS", "APPDATA"]);

export type EnvStatus = {
  name: string;
  set: boolean;
  // A safe fact about the value (never the value): "3 keys", "role qts_runtime", "48 characters".
  detail: string | null;
  // Something to fix on this deployment.
  problem: string | null;
};

const listCount = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean).length;

/** The database user's name in a connection address, or null (the address itself is never returned). */
export function databaseRole(value: string): string | null {
  try {
    const name = decodeURIComponent(new URL(value).username || "");
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Whether each listed variable is set on this deployment, with a safe fact about it and any problem.
 * onVercel: true on the live site (Vercel), where the local-only ones are not expected.
 */
export function readEnvStatus(env: Record<string, string | undefined>, onVercel: boolean): EnvStatus[] {
  return ENV_VAR_GUIDE.map(({ name, need }) => {
    const value = env[name]?.trim() ?? "";
    const set = value.length > 0;
    let detail: string | null = null;
    let problem: string | null = null;
    if (name === "DATABASE_URL" && set) {
      const role = databaseRole(value);
      detail = role ? `role ${role}` : "address not readable";
      if (!role) problem = "The address is not a valid postgresql:// URL.";
      else if (onVercel && role === "neondb_owner") problem = "The live site uses the owner. Use the qts_runtime user on Vercel.";
    } else if (name === "AUTH_SECRET" && set) {
      const length = Buffer.byteLength(value, "utf8");
      detail = `${length} characters`;
      if (length < 32) problem = "Too short: at least 32 characters are needed, or sign-in stops working.";
    } else if ((name === "GEMINI_API_KEYS" || name === "GROQ_API_KEYS" || name === "NEON_PROJECT_ID") && set) {
      const count = listCount(value);
      detail = `${count} ${name === "NEON_PROJECT_ID" ? (count === 1 ? "project" : "projects") : count === 1 ? "key" : "keys"}`;
    } else if ((name === "ENABLE_GEMINI_TOKEN_COMPARISON") && set) {
      detail = value === "true" ? "on" : "off (only true turns it on)";
    } else if (name === "QTS_ANSWER_IDENTITY_V1") {
      detail = value === "0" ? "matching off" : "matching on";
    } else if ((name === "NODE_ENV" || name === "VERCEL" || name === "VERCEL_ENV" || name === "VERCEL_GIT_COMMIT_REF") && set) {
      detail = value.slice(0, 40);
    } else if (name === "VERCEL_GIT_COMMIT_SHA" && set) {
      detail = value.slice(0, 7);
    }
    if (!set && need === "required") {
      const fallback = name === "GEMINI_API_KEYS" && (env.GEMINI_API_KEY?.trim() || env.JD_READ_PROMPT_GEMINI_API_KEY_1?.trim());
      if (fallback) detail = "a single key is set instead";
      else if (name === "GEMINI_API_KEYS" && !onVercel) detail = "not needed on this PC";
      else if (name === "GEMINI_API_KEYS") problem = "Missing: Get JD checks and Ask AI cannot call Gemini.";
      else problem = "Missing: the site cannot start without it.";
    }
    if (name === "NEON_API_KEY" && set && !env.NEON_PROJECT_ID?.trim()) problem = "Also set NEON_PROJECT_ID, or Database usage cannot read Neon's numbers.";
    return { name, set, detail, problem };
  });
}
