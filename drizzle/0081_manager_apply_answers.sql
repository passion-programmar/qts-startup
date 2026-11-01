CREATE TABLE "manager_apply_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "manager_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "candidate_id" uuid REFERENCES "profiles"("user_id") ON DELETE CASCADE,
  "job_id" uuid REFERENCES "jobs"("id") ON DELETE CASCADE,
  "scope" text NOT NULL,
  "context_key" text NOT NULL,
  "question_key" text NOT NULL,
  "question_text" text NOT NULL,
  "answer" text NOT NULL,
  "variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "manager_apply_answers_scope_check" CHECK ("scope" IN ('manager', 'candidate', 'application')),
  CONSTRAINT "manager_apply_answers_owner_scope_check" CHECK (
    ("scope" = 'manager' AND "candidate_id" IS NULL AND "job_id" IS NULL) OR
    ("scope" = 'candidate' AND "candidate_id" IS NOT NULL AND "job_id" IS NULL) OR
    ("scope" = 'application' AND "candidate_id" IS NOT NULL AND "job_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "manager_apply_answers_context_unique" ON "manager_apply_answers" ("manager_id", "context_key", "question_key");
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "manager_category" text DEFAULT '' NOT NULL;
