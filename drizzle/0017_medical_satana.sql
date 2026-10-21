CREATE TYPE "public"."generation_run_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"job_url" text NOT NULL,
	"job_title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"job_description" text NOT NULL,
	"prompt_template" text NOT NULL,
	"composed_prompt" text NOT NULL,
	"response_text" text,
	"response_json" jsonb,
	"status" "generation_run_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_runs_manager_created_at_index" ON "generation_runs" USING btree ("manager_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_runs_manager_status_index" ON "generation_runs" USING btree ("manager_id","status");