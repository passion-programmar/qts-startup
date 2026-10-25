ALTER TABLE "bids" ADD COLUMN "job_key" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "title_company_key" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "page_text" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "relation_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "job_key" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "title_company_key" text;--> statement-breakpoint
CREATE INDEX "bids_manager_job_key_index" ON "bids" USING btree ("manager_id","job_key");--> statement-breakpoint
CREATE INDEX "bids_manager_title_company_key_index" ON "bids" USING btree ("manager_id","title_company_key");--> statement-breakpoint
CREATE INDEX "jobs_relation_id_index" ON "jobs" USING btree ("relation_id");--> statement-breakpoint
CREATE INDEX "jobs_job_key_index" ON "jobs" USING btree ("job_key");--> statement-breakpoint
CREATE INDEX "jobs_title_company_key_index" ON "jobs" USING btree ("title_company_key");