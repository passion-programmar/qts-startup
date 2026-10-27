CREATE TABLE "apply_question_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"kind" text DEFAULT 'choice' NOT NULL,
	"times_seen" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apply_question_memory_kind_check" CHECK ("apply_question_memory"."kind" in ('choice', 'text'))
);
--> statement-breakpoint
ALTER TABLE "reusable_answers" ADD COLUMN "auto_added" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_question_memory_question_key_unique" ON "apply_question_memory" USING btree ("question_key");--> statement-breakpoint
CREATE INDEX "apply_question_memory_last_seen_index" ON "apply_question_memory" USING btree ("last_seen_at");