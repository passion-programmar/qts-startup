import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { computeTitleCompanyKey } from "../jobs/job-key";
import {
  parseRemoteCompaniesQuery,
  remoteCompaniesPageQuery,
  remoteCompanyApplicationsQuery,
  toRemoteCompanies,
  type RemoteCompaniesRow,
} from "./remote-companies-query";

// Optional in-memory PostgreSQL, never DATABASE_URL. Install only into the ignored verification
// folder: npm install --prefix .pdf-verification/task3-test-tools --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
const engine = resolve(process.env.QTS_TEST_PGLITE_PATH || ".pdf-verification/task3-test-tools/node_modules/@electric-sql/pglite/dist/index.cjs");
type Engine = { exec(sql: string): Promise<unknown>; query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> };
type Row = { company: string; job_title: string; places: string[]; job_count: number; bid_count: number; first_seen_at: Date; last_seen_at: Date };

const migration = readFileSync(resolve("drizzle/0105_remote_companies.sql"), "utf8");
const dialect = new PgDialect();
const key = computeTitleCompanyKey;
const quote = (value: string | null) => value === null ? "null" : `'${value.replace(/'/g, "''")}'`;

test("parsing the page address keeps only known values", () => {
  assert.deepEqual(parseRemoteCompaniesQuery({}), { field: "all", q: "", sort: "recent", page: 1, size: 25 });
  assert.deepEqual(parseRemoteCompaniesQuery({ field: "place", q: "  Poland ", sort: "roles", page: "3", size: "50" }), { field: "place", q: "Poland", sort: "roles", page: 3, size: 50 });
  assert.deepEqual(parseRemoteCompaniesQuery({ field: "drop table", sort: "x", page: "-2", size: "1000" }), { field: "all", q: "", sort: "recent", page: 1, size: 25 });
});

test("remote companies: guarded triggers, backfill and the page query on real PostgreSQL", {
  skip: !existsSync(engine) && "Install the isolated PGlite test engine or set QTS_TEST_PGLITE_PATH (no production connection)",
}, async (t) => {
  const { PGlite } = createRequire(__filename)(engine) as { PGlite: new () => Engine };
  const pg = new PGlite();
  const job = (title: string, company: string, location: string | null, workplace: string | null, at = "now()") =>
    `insert into jobs (job_title, company, location, workplace_type, title_company_key, created_at) values (${quote(title)}, ${quote(company)}, ${quote(location)}, ${quote(workplace)}, ${quote(key(title, company) || null)}, ${at})`;
  const bid = (title: string, company: string, location: string | null, workType: string | null, at = "now()", withKey = true) =>
    `insert into bids (job_title, company, location, work_type, title_company_key, applied_at) values (${quote(title)}, ${quote(company)}, ${quote(location)}, ${quote(workType)}, ${withKey ? quote(key(title, company) || null) : "null"}, ${at})`;
  const row = async (title: string, company: string) => {
    const [titleKey, companyKey] = key(title, company).split("|");
    return (await pg.query<Row>("select * from remote_company_jobs where company_key = $1 and title_key = $2", [companyKey, titleKey])).rows[0];
  };
  const count = async () => (await pg.query<{ n: number }>("select count(*)::int as n from remote_company_jobs")).rows[0].n;
  const page = async (raw: Record<string, string>) => {
    const query = parseRemoteCompaniesQuery(raw);
    const compiled = dialect.sqlToQuery(remoteCompaniesPageQuery(query, query.page));
    return toRemoteCompanies((await pg.query<RemoteCompaniesRow>(compiled.sql, compiled.params)).rows[0]);
  };

  await pg.exec(`
    create table users (id uuid primary key default gen_random_uuid());
    create table jobs (id uuid primary key default gen_random_uuid(), job_title text not null, company text not null,
      location text, workplace_type text, title_company_key text, created_at timestamptz not null default now());
    create table bids (id uuid primary key default gen_random_uuid(), job_title text not null, company text not null,
      location text, work_type text, title_company_key text, applied_at timestamptz not null default now());
    insert into users default values;
    ${job("Senior DevOps Engineer", "N-iX LLC", "Slovakia (Remote)", "Remote", "'2026-11-01T10:00:00Z'")};
    ${job("Backend Developer", "Essen Werke GmbH", "Essen, remote", "Hybrid", "'2026-11-02T10:00:00Z'")};
    ${bid("Senior DevOps Engineer (Remote)", "N-iX", "Poland", "Full-time · Remote", "'2026-11-05T10:00:00Z'")};
    ${bid("Site Reliability Engineer", "Acme Inc", "Remote", null, "'2026-11-03T10:00:00Z'")};
    ${bid("Data Engineer", "Nokey Corp", "Remote", "Remote", "'2026-11-04T10:00:00Z'", false)};
    ${bid("Frontend Developer", "Berlin Shop", "Berlin (On-site)", "Full-time", "'2026-11-04T10:00:00Z'")};
    ${bid("QA Engineer", "Mixed Ltd", "Remote", "Full-time · Hybrid", "'2026-11-04T10:00:00Z'")};
  `);
  // Drizzle runs a migration file statement by statement, split the same way.
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await pg.exec(statement);
  }

  try {
    await t.test("the remote rule: remote as a word, never hybrid or on-site", async () => {
      const cases: [string | null, string | null, boolean][] = [
        ["Slovakia (Remote)", null, true], ["Remote", null, true], [null, "Full-time · Remote", true], ["Poland", "REMOTE", true],
        ["Essen, remote", "Hybrid", false], ["Berlin (On-site)", "Full-time", false], ["Remote", "Full-time · Hybrid", false],
        ["Remote or onsite", null, false], ["Remotely possible office", null, false], [null, null, false], ["Poland", "Full-time", false],
      ];
      for (const [place, arrangement, want] of cases) {
        const { rows } = await pg.query<{ remote: boolean }>("select qts_is_fully_remote($1, $2) as remote", [place, arrangement]);
        assert.equal(rows[0].remote, want, `${place} / ${arrangement}`);
      }
    });

    await t.test("the backfill keeps one row per company and role, oldest first", async () => {
      assert.equal(await count(), 2, "N-iX DevOps and Acme SRE only");
      const devops = await row("Senior DevOps Engineer", "N-iX");
      assert.deepEqual(devops.places, ["Slovakia (Remote)", "Poland"]);
      assert.equal(devops.job_count, 1);
      assert.equal(devops.bid_count, 1);
      assert.equal(devops.company, "N-iX", "the newest sighting names the row");
      assert.equal(devops.job_title, "Senior DevOps Engineer (Remote)");
      assert.equal(new Date(devops.first_seen_at).toISOString(), "2026-11-01T10:00:00.000Z");
      assert.equal(new Date(devops.last_seen_at).toISOString(), "2026-11-05T10:00:00.000Z");
      assert.deepEqual((await row("Site Reliability Engineer", "Acme")).places, ["Remote"]);
      const { rows } = await pg.query<{ on: boolean }>("select can_view_remote_companies as on from users");
      assert.equal(rows[0].on, false, "the page is off for everyone until the Super Admin turns it on");
    });

    await t.test("a job saved again is the same row: counted once more, its place added once", async () => {
      await pg.exec(job("Senior DevOps Engineer", "N-iX", "poland", "Remote"));
      const devops = await row("Senior DevOps Engineer", "N-iX");
      assert.equal(await count(), 2);
      assert.deepEqual(devops.places, ["Slovakia (Remote)", "Poland"], "a place differing only in case is not added again");
      assert.equal(devops.job_count, 2);
    });

    await t.test("job updates: unchanged saves nothing, a new place is added, a job turned remote counts", async () => {
      await pg.exec(job("Platform Engineer", "Acme", "Remote", "Remote"));
      assert.equal((await row("Platform Engineer", "Acme")).job_count, 1);
      await pg.exec("update jobs set location = location, workplace_type = workplace_type where job_title = 'Platform Engineer'");
      assert.equal((await row("Platform Engineer", "Acme")).job_count, 1, "a save with nothing changed is not a new sighting");
      await pg.exec("update jobs set location = 'Romania (Remote)' where job_title = 'Platform Engineer'");
      const platform = await row("Platform Engineer", "Acme");
      assert.deepEqual(platform.places, ["Remote", "Romania (Remote)"]);
      assert.equal(platform.job_count, 1, "the same job with a corrected place is still one save");

      assert.equal(await row("Backend Developer", "Essen Werke"), undefined);
      await pg.exec("update jobs set workplace_type = 'Remote' where job_title = 'Backend Developer'");
      assert.equal((await row("Backend Developer", "Essen Werke")).job_count, 1, "a hybrid job corrected to remote is added");
    });

    await t.test("bids: each new remote bid counts; not remote, hybrid or without a key is left out", async () => {
      const before = await count();
      await pg.exec(bid("Site Reliability Engineer", "ACME Inc.", "Canada (Remote)", "Contract · Remote"));
      await pg.exec(bid("Office Manager", "Acme", "Bucharest", "Full-time"));
      await pg.exec(bid("Support Engineer", "Acme", "Remote", "Full-time · Hybrid"));
      await pg.exec(bid("Mystery Role", "", "Remote", "Remote"));
      assert.equal(await count(), before, "only the SRE bid, which already has a row");
      const sre = await row("Site Reliability Engineer", "Acme");
      assert.equal(sre.bid_count, 2);
      assert.deepEqual(sre.places, ["Remote", "Canada (Remote)"]);
    });

    await t.test("a role keeps at most 30 places; its counts still add up", async () => {
      for (let index = 0; index < 35; index += 1) await pg.exec(bid("Cloud Engineer", "Wide Co", `Country ${index} (Remote)`, "Remote"));
      const wide = await row("Cloud Engineer", "Wide");
      assert.equal(wide.places.length, 30);
      assert.equal(wide.bid_count, 35);
    });

    await t.test("guarded: when the list cannot be written, the job and the bid are still saved", async () => {
      await pg.exec("alter table remote_company_jobs rename to remote_company_jobs_away");
      try {
        await pg.exec(job("Guarded Role", "Safe Co", "Remote", "Remote"));
        await pg.exec(bid("Guarded Role", "Safe Co", "Remote", "Remote"));
        const saved = await pg.query<{ n: number }>("select (select count(*) from jobs where company = 'Safe Co') + (select count(*) from bids where company = 'Safe Co') as n");
        assert.equal(Number(saved.rows[0].n), 2);
      } finally {
        await pg.exec("alter table remote_company_jobs_away rename to remote_company_jobs");
      }
    });

    await t.test("the page: companies with their roles, newest first, one row per company", async () => {
      const list = await page({});
      // Safe Co was saved while the list could not be written, so it is not here.
      assert.equal(list.all, 4);
      assert.equal(list.total, 4);
      assert.deepEqual(list.companies.map((company) => company.company), ["Wide Co", "ACME Inc.", "Essen Werke GmbH", "N-iX"]);
      const acme = list.companies.find((company) => company.companyKey === "acme");
      assert.ok(acme);
      assert.equal(acme.roles, 2);
      assert.deepEqual(acme.items.map((role) => role.title).sort(), ["Platform Engineer", "Site Reliability Engineer"]);
      assert.equal(acme.bids, 2);
      assert.equal(acme.jobs, 1);
      assert.ok(acme.lastSeen instanceof Date && !Number.isNaN(acme.lastSeen.getTime()));
    });

    await t.test("the page: sort, search by company key, title and place, and paging", async () => {
      assert.equal((await page({ sort: "roles" })).companies[0].companyKey, "acme");
      assert.deepEqual((await page({ sort: "name" })).companies.map((company) => company.companyKey), ["acme", "essen werke", "n ix", "wide"]);
      const nix = await page({ q: "nix", field: "company" });
      assert.deepEqual(nix.companies.map((company) => company.company), ["N-iX"]);
      assert.equal(nix.all, 4, "all companies are still counted while searching");
      const byTitle = await page({ q: "platform", field: "title" });
      assert.deepEqual(byTitle.companies.map((company) => company.items.map((role) => role.title)), [["Platform Engineer"]], "only matching roles show");
      const byPlace = await page({ q: "romania", field: "place" });
      assert.deepEqual(byPlace.companies.map((company) => company.companyKey), ["acme"]);
      const any = await page({ q: "100%_" });
      assert.equal(any.total, 0, "% and _ are searched as text");
      const second = await page({ size: "10", page: "2" });
      assert.equal(second.companies.length, 0);
      assert.equal(second.total, 4);
    });

    await t.test("each role carries its key, so its details can find who applied", async () => {
      const acme = (await page({ q: "acme", field: "company" })).companies[0];
      assert.deepEqual(acme.items.map((role) => role.titleKey).sort(), ["platform engineer", "site reliability engineer"]);
    });

    await t.test("who applied: a Manager sees their own candidates' names, the Super Admin sees all and the Manager", async () => {
      const ann = "20000000-0000-4000-8000-000000000001";
      const bob = "20000000-0000-4000-8000-000000000002";
      const superAdmin = "20000000-0000-4000-8000-000000000009";
      await pg.exec(`
        alter table bids add column manager_id uuid, add column candidate_id uuid;
        alter table users add column display_name text;
        create table profiles (user_id uuid primary key, first_name text, last_name text);
        insert into users (id, display_name) values ('${ann}', 'Ann'), ('${bob}', 'Bob');
        insert into profiles values ('30000000-0000-4000-8000-000000000001', 'Jane', 'Doe'), ('30000000-0000-4000-8000-000000000002', 'Omar', 'Ali');
      `);
      const sre = key("Site Reliability Engineer", "Acme");
      await pg.exec(`
        insert into bids (job_title, company, location, work_type, title_company_key, applied_at, manager_id, candidate_id) values
          ('Site Reliability Engineer', 'Acme', 'Spain (Remote)', 'Remote', '${sre}', '2026-11-20T10:00:00Z', '${ann}', '30000000-0000-4000-8000-000000000001'),
          ('Site Reliability Engineer', 'Acme', 'Spain', 'Full-time · Remote', '${sre}', '2026-11-21T10:00:00Z', '${bob}', '30000000-0000-4000-8000-000000000002'),
          ('Site Reliability Engineer', 'Acme', 'Spain', 'Hybrid', '${sre}', '2026-11-21T11:00:00Z', '${ann}', '30000000-0000-4000-8000-000000000001');
      `);
      type Who = { titleKey: string; candidate: string | null; manager: string | null; own: boolean | null; appliedAt: Date; place: string | null };
      const who = async (viewer: { id: string; superAdmin: boolean }) => {
        const compiled = dialect.sqlToQuery(remoteCompanyApplicationsQuery("acme", viewer));
        return (await pg.query<Who>(compiled.sql, compiled.params)).rows.filter((row) => row.candidate !== null || row.own === false);
      };

      const asAnn = await who({ id: ann, superAdmin: false });
      assert.deepEqual(asAnn.map((row) => [row.candidate, row.manager, row.own]), [[null, null, false], ["Jane Doe", null, true]],
        "newest first; Bob's candidate has no name for Ann; the hybrid bid is not a remote application");
      assert.ok(asAnn.every((row) => row.titleKey === "site reliability engineer"));

      const asSuperAdmin = await who({ id: superAdmin, superAdmin: true });
      assert.deepEqual(asSuperAdmin.map((row) => [row.candidate, row.manager]), [["Omar Ali", "Bob"], ["Jane Doe", "Ann"]]);
    });
  } finally {
    await pg.close();
  }
});
