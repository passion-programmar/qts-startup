DROP INDEX "jobs_job_key_index";--> statement-breakpoint
DROP INDEX "jobs_title_company_key_index";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_job_key_candidate_unique" ON "jobs" USING btree ("job_key","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_title_company_key_candidate_unique" ON "jobs" USING btree ("title_company_key","candidate_id");--> statement-breakpoint
-- Get JD matching is per Manager now (users.use_gemini_matching, migration 0048).
DELETE FROM "settings" WHERE "key" = 'get_jd_matching_mode';
