-- A Manager can now be assigned several global prompts; Generation rotates through them.
-- The primary key was declared inline in 0008, so it carries Postgres's default name.
ALTER TABLE "manager_prompt_assignments" DROP CONSTRAINT "manager_prompt_assignments_pkey";--> statement-breakpoint
ALTER TABLE "manager_prompt_assignments" ADD CONSTRAINT "manager_prompt_assignments_manager_id_prompt_id_pk" PRIMARY KEY("manager_id","prompt_id");--> statement-breakpoint
ALTER TABLE "manager_prompt_assignments" ADD COLUMN "last_used_at" timestamp with time zone;
