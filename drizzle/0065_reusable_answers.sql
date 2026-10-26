CREATE TABLE "reusable_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD CONSTRAINT "reusable_answers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_answers_question_key_unique" ON "reusable_answers" USING btree ("question_key");;--> statement-breakpoint
-- The seeded Apply answer prompt names these answers; changed only while Super Admin has not edited it.
UPDATE "prompts" SET "prompt_template" = replace("prompt_template", 'Answers the candidate gave before:', 'Reusable answers (when one matches a question, use it, adapted to the field''s choices and type):'), "updated_at" = now()
WHERE "provider" = 'openai' AND "purpose" = 'application_answer' AND "name" = 'Apply answers (default)' AND "version" = 1
  AND "prompt_template" LIKE '%Answers the candidate gave before:%';
