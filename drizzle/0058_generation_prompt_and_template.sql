ALTER TABLE "bids" ADD COLUMN "prompt_id" uuid;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "pdf_template" text;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "prompt_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "prompt_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pdf_template" text;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;