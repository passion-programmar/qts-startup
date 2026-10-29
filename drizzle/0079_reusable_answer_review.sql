-- Review for reusable answers, additive only: reusable_answers keeps every existing row, its question_key
-- unique index and its meaning (every row is approved and used by Apply). Drafts and rejected answers live in
-- reusable_answer_drafts and earlier versions in reusable_answer_versions, which older code never reads.
CREATE TABLE "reusable_answer_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reusable_answer_drafts_status_check" CHECK ("reusable_answer_drafts"."status" in ('draft', 'rejected')),
	CONSTRAINT "reusable_answer_drafts_source_check" CHECK ("reusable_answer_drafts"."source" in ('learned', 'manager', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "reusable_answer_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"note" text,
	"auto_added" boolean NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"answer_created_at" timestamp with time zone NOT NULL,
	"answer_updated_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"replaced_by_user_id" uuid,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reusable_answer_versions_reason_check" CHECK ("reusable_answer_versions"."reason" in ('edited', 'replaced', 'restored', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Answers Apply's learning added before review existed came from it.
UPDATE "reusable_answers" SET "source" = 'learned' WHERE "auto_added";--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reusable_answer_drafts" ADD CONSTRAINT "reusable_answer_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reusable_answer_drafts" ADD CONSTRAINT "reusable_answer_drafts_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reusable_answer_versions" ADD CONSTRAINT "reusable_answer_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reusable_answer_versions" ADD CONSTRAINT "reusable_answer_versions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reusable_answer_versions" ADD CONSTRAINT "reusable_answer_versions_replaced_by_user_id_users_id_fk" FOREIGN KEY ("replaced_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_answer_drafts_waiting_question_unique" ON "reusable_answer_drafts" USING btree ("question_key") WHERE "reusable_answer_drafts"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "reusable_answer_drafts_creator_index" ON "reusable_answer_drafts" USING btree ("created_by_user_id","status");--> statement-breakpoint
CREATE INDEX "reusable_answer_versions_question_index" ON "reusable_answer_versions" USING btree ("question_key","replaced_at");--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD CONSTRAINT "reusable_answers_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD CONSTRAINT "reusable_answers_source_check" CHECK ("reusable_answers"."source" in ('manual', 'learned', 'manager', 'ai'));