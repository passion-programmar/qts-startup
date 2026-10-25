ALTER TABLE "bids" ADD COLUMN "generation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Applied means a bid exists (src/server/jobs/job-bids.ts): rows a bid covers become Applied.
-- Rows marked Applied without a bid are left as they are for review.
UPDATE "jobs" SET "status" = 'applied', "updated_at" = now()
 WHERE "status" <> 'applied'
   AND EXISTS (
     SELECT 1 FROM "bids" b
      WHERE b."source_job_id" = "jobs"."id"
         OR (b."manager_id" = "jobs"."manager_id"
             AND b."candidate_id" = "jobs"."candidate_id"
             AND (regexp_replace(split_part(btrim(b."job_url"), '#', 1), '/+$', '')
                    = regexp_replace(split_part(btrim("jobs"."job_url"), '#', 1), '/+$', '')
                  OR b."title_company_key" = "jobs"."title_company_key")));--> statement-breakpoint
-- Link existing bids to the delivered Generation run of the row they were made from.
UPDATE "bids" SET "generation_run_id" = (
  SELECT r."id" FROM "generation_runs" r
   WHERE r."job_id" = "bids"."source_job_id" AND r."status"::text = 'delivered'
   ORDER BY r."created_at" DESC LIMIT 1)
 WHERE "generation_run_id" IS NULL;
