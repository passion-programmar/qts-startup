CREATE TABLE "manager_unanswered_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manager_unanswered_questions" ADD CONSTRAINT "manager_unanswered_questions_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manager_unanswered_questions_unique" ON "manager_unanswered_questions" USING btree ("manager_id","question_key");