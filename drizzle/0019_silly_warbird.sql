CREATE TYPE "public"."generation_queue_status" AS ENUM('not_queued', 'queued', 'processing', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "generation_status" "generation_queue_status" DEFAULT 'not_queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "generation_error" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "generation_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;