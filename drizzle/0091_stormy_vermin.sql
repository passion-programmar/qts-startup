CREATE TYPE "public"."interview_result" AS ENUM('waiting', 'passed', 'rejected', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."interview_step" AS ENUM('intro', 'tech', 'final', 'offer');--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"bid_id" uuid,
	"candidate_id" uuid NOT NULL,
	"category" text,
	"applied_at" timestamp with time zone NOT NULL,
	"company" text NOT NULL,
	"job_title" text NOT NULL,
	"job_url" text NOT NULL,
	"interviewer" text,
	"step" "interview_step" NOT NULL,
	"result" "interview_result" DEFAULT 'waiting' NOT NULL,
	"interview_date" date NOT NULL,
	"interview_time" text NOT NULL,
	"meeting_link" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interviews_time_format" CHECK ("interviews"."interview_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."bids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidate_id_profiles_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_manager_date_time_index" ON "interviews" USING btree ("manager_id","interview_date","interview_time");--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_bid_step_date_unique" ON "interviews" USING btree ("bid_id","step","interview_date");