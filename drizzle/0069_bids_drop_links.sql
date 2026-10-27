ALTER TABLE "bids" DROP CONSTRAINT "bids_confirmation_status_check";--> statement-breakpoint
ALTER TABLE "bids" DROP CONSTRAINT "bids_generation_run_id_generation_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "bids" DROP CONSTRAINT "bids_prompt_id_prompts_id_fk";
--> statement-breakpoint
DROP INDEX "bids_source_job_id_unique";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "source_job_id";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "employment_type";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "workplace_type";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "resume_local_path";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "generation_run_id";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "prompt_id";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "pdf_template";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "confirmation_status";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "confirmation_source";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "apply_attempt_id";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "apply_evidence";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "screenshot_browser_name";