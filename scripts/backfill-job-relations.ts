// Fills job_key, title_company_key and relation_id on existing jobs rows, and
// the same keys on bids (docs/get-jd-redesign.md, section 8, step 2).
//
//   npm run db:backfill:job-relations            report only, writes nothing
//   npm run db:backfill:job-relations -- --apply write the keys
//
// Run against a Neon branch first. Safe to re-run: keys are recomputed and an
// existing relation_id is kept. Rows of the same account that land in one job
// are reported, never deleted; they must be resolved before the constrain step
// adds the unique indexes.

import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { computeJobKey, computeTitleCompanyKey } from "../src/server/jobs/job-key";
import { planJobRelations, type JobRelationRow } from "../src/server/jobs/job-relations";

loadEnvConfig(process.cwd());

const apply = process.argv.includes("--apply");
const batchSize = 500;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be configured.");
  const sql = neon(databaseUrl);

  const jobs = (await sql.query(
    `SELECT id, job_url, job_title, company, candidate_id, manager_id, relation_id
       FROM jobs ORDER BY created_at, id`,
  )).map((row): JobRelationRow => ({
    id: row.id,
    jobUrl: row.job_url,
    jobTitle: row.job_title,
    company: row.company,
    candidateId: row.candidate_id,
    managerId: row.manager_id,
    relationId: row.relation_id,
  }));
  const bids = await sql.query(`SELECT id, job_url, job_title, company FROM bids`);
  const plan = planJobRelations(jobs, randomUUID);

  console.log(`Jobs rows: ${jobs.length}`);
  console.log(`Jobs (relation groups): ${plan.groupCount}`);
  console.log(`Groups merging several rows: ${plan.mergedGroupCount}`);
  console.log(`Groups shared by several Managers: ${plan.sharedAcrossManagersCount}`);
  console.log(
    `Rows without a usable URL key: ${plan.rowsWithoutJobKey.length}`
      + (plan.rowsWithoutJobKey.length ? ` (${plan.rowsWithoutJobKey.slice(0, 20).join(", ")})` : ""),
  );
  console.log(`Bids rows: ${bids.length}`);
  if (plan.conflictingRelationIds.length) {
    console.log(`Groups that already had different relation_ids (kept the first): ${plan.conflictingRelationIds.length}`);
  }
  if (plan.collisions.length) {
    console.log(`\nSame account twice in one job (resolve before the constrain step): ${plan.collisions.length}`);
    for (const collision of plan.collisions.slice(0, 50)) {
      console.log(`  account ${collision.candidateId}: rows ${collision.rowIds.join(", ")}`);
    }
    if (plan.collisions.length > 50) console.log(`  … and ${plan.collisions.length - 50} more`);
  } else {
    console.log("\nNo account has the same job twice. The constrain step can run after --apply.");
  }

  if (!apply) {
    console.log("\nReport only. Re-run with --apply to write the keys.");
    return;
  }

  for (let index = 0; index < plan.updates.length; index += batchSize) {
    const batch = plan.updates.slice(index, index + batchSize);
    await sql.query(
      `UPDATE jobs AS j
          SET relation_id = v.relation_id, job_key = v.job_key, title_company_key = v.title_company_key
         FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
              AS v(id, relation_id, job_key, title_company_key)
        WHERE j.id = v.id`,
      [
        batch.map((update) => update.id),
        batch.map((update) => update.relationId),
        batch.map((update) => update.jobKey),
        batch.map((update) => update.titleCompanyKey),
      ],
    );
  }
  for (let index = 0; index < bids.length; index += batchSize) {
    const batch = bids.slice(index, index + batchSize);
    await sql.query(
      `UPDATE bids AS b
          SET job_key = v.job_key, title_company_key = v.title_company_key
         FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, job_key, title_company_key)
        WHERE b.id = v.id`,
      [
        batch.map((bid) => bid.id),
        batch.map((bid) => computeJobKey({ url: bid.job_url, title: bid.job_title, company: bid.company })),
        batch.map((bid) => computeTitleCompanyKey(bid.job_title, bid.company) || null),
      ],
    );
  }
  console.log(`\nWrote keys to ${plan.updates.length} jobs rows and ${bids.length} bids rows.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
