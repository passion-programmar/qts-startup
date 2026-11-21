import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { databaseRole, ENV_NOT_LISTED, ENV_VAR_GUIDE, readEnvStatus } from "./env-guide-values";

// The System guide lists every environment variable the code reads, and nothing it does not read,
// so it stays true when code changes. This test reads the code the same way a person would grep it.

const root = join(__dirname, "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".vercel", "vendor", ".pdf-verification"]);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx|js|cjs|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

// The guide's own files name every variable on purpose; they are not "code that reads" one.
const guideFiles = new Set(["src/server/system/env-guide-values.ts", "src/server/system/env-guide-values.test.ts"]);
const codeFiles = [
  ...filesUnder(join(root, "src")),
  ...filesUnder(join(root, "scripts")),
  join(root, "drizzle.config.ts"),
  join(root, "next.config.ts"),
].filter((path) => !guideFiles.has(relative(root, path).replace(/\\/g, "/")));

function namesReadByCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g,
    /requiredEnvironmentVariable\(["']([A-Z][A-Z0-9_]+)["']\)/g,
  ];
  for (const path of codeFiles) {
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1] as string;
        found.set(name, [...(found.get(name) ?? []), relative(root, path)]);
      }
    }
  }
  return found;
}

test("every environment variable the code reads is in the System guide", () => {
  const listed = new Set(ENV_VAR_GUIDE.map((entry) => entry.name));
  const missing = [...namesReadByCode().entries()]
    .filter(([name]) => !listed.has(name) && !ENV_NOT_LISTED.has(name))
    .map(([name, files]) => `${name} (read in ${[...new Set(files)].join(", ")})`);
  assert.deepEqual(missing, [], "Add these to ENV_VAR_GUIDE in src/server/system/env-guide-values.ts");
});

test("every variable in the System guide is read by the code, except the one marked unused", () => {
  const read = namesReadByCode();
  for (const entry of ENV_VAR_GUIDE) {
    if (entry.need === "unused") assert.equal(read.has(entry.name), false, `${entry.name} is read now: describe what it does`);
    else assert.ok(read.has(entry.name), `${entry.name} is listed but no code reads it`);
  }
});

test("every name in .env.example is explained in the System guide", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1] as string);
  const listed = new Set(ENV_VAR_GUIDE.map((entry) => entry.name));
  assert.deepEqual(names.filter((name) => !listed.has(name)), []);
});

test("the status check gives safe facts only, never a value", () => {
  const secretUrl = "postgresql://qts_runtime:SuperSecretPassword123@ep-test.neon.tech/neondb?sslmode=require";
  const status = readEnvStatus({
    DATABASE_URL: secretUrl,
    AUTH_SECRET: "x".repeat(40),
    GEMINI_API_KEYS: "AIzaFirstKey, AIzaSecondKey,AIzaThirdKey",
    GROQ_API_KEYS: "gsk_one",
    NEON_API_KEY: "neon_secret_key",
    VERCEL_ENV: "production",
  }, true);
  const text = JSON.stringify(status);
  for (const secret of ["SuperSecretPassword123", "AIzaFirstKey", "gsk_one", "neon_secret_key", "x".repeat(40)]) {
    assert.equal(text.includes(secret), false, `${secret} must never be shown`);
  }
  const byName = Object.fromEntries(status.map((entry) => [entry.name, entry]));
  assert.equal(byName.DATABASE_URL?.detail, "role qts_runtime");
  assert.equal(byName.AUTH_SECRET?.detail, "40 characters");
  assert.equal(byName.GEMINI_API_KEYS?.detail, "3 keys");
  assert.equal(byName.GROQ_API_KEYS?.detail, "1 key");
  assert.match(byName.NEON_API_KEY?.problem ?? "", /NEON_PROJECT_ID/);
});

test("the status check flags the owner on the live site, a short secret and missing required ones", () => {
  const live = Object.fromEntries(readEnvStatus({
    DATABASE_URL: "postgresql://neondb_owner:pw@ep-test.neon.tech/neondb",
    AUTH_SECRET: "short",
  }, true).map((entry) => [entry.name, entry]));
  assert.match(live.DATABASE_URL?.problem ?? "", /qts_runtime/);
  assert.match(live.AUTH_SECRET?.problem ?? "", /32/);
  assert.match(live.GEMINI_API_KEYS?.problem ?? "", /Gemini/);
  // On this PC the owner is expected (migrations), and Gemini keys are not needed.
  const local = Object.fromEntries(readEnvStatus({ DATABASE_URL: "postgresql://neondb_owner:pw@ep-test.neon.tech/neondb", AUTH_SECRET: "y".repeat(32) }, false)
    .map((entry) => [entry.name, entry]));
  assert.equal(local.DATABASE_URL?.problem, null);
  assert.equal(local.GEMINI_API_KEYS?.problem, null);
  // One Gemini key under the old name still counts.
  const single = Object.fromEntries(readEnvStatus({ GEMINI_API_KEY: "one" }, true).map((entry) => [entry.name, entry]));
  assert.equal(single.GEMINI_API_KEYS?.problem, null);
});

test("a database address gives only its user name, and a broken one gives nothing", () => {
  assert.equal(databaseRole("postgresql://qts_runtime:pw@host/db"), "qts_runtime");
  assert.equal(databaseRole("not a url with password=abc"), null);
  assert.equal(databaseRole(""), null);
});
