CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('todo', 'pending', 'applied', 'failed');--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_job_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_url" text NOT NULL,
	"job_title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"employment_type" text,
	"resume_local_path" text NOT NULL,
	"googledriver_path" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_url" text NOT NULL,
	"job_title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"candidate_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "job_status" DEFAULT 'todo' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_candidate_id_profiles_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_candidate_id_profiles_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bids_source_job_id_unique" ON "bids" USING btree ("source_job_id");--> statement-breakpoint
CREATE INDEX "bids_manager_applied_at_index" ON "bids" USING btree ("manager_id","applied_at");--> statement-breakpoint
CREATE INDEX "bids_candidate_applied_at_index" ON "bids" USING btree ("candidate_id","applied_at");--> statement-breakpoint
CREATE INDEX "bids_job_title_trgm_index" ON "bids" USING gin ("job_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bids_job_url_trgm_index" ON "bids" USING gin ("job_url" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jobs_manager_date_index" ON "jobs" USING btree ("manager_id","date");--> statement-breakpoint
CREATE INDEX "jobs_candidate_date_status_index" ON "jobs" USING btree ("candidate_id","date","status");--> statement-breakpoint
CREATE INDEX "jobs_job_title_trgm_index" ON "jobs" USING gin ("job_title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jobs_job_url_trgm_index" ON "jobs" USING gin ("job_url" gin_trgm_ops);