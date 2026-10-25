-- Managers now write their own prompts; Super Admin no longer assigns library prompts,
-- picks rotation templates, or keeps a single "own prompt" per Manager.
DROP TABLE "manager_prompt_assignments";--> statement-breakpoint
DROP TABLE "manager_prompt_overrides";--> statement-breakpoint
DROP TABLE "manager_template_assignments";--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_category_only_for_documents_check";--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT "prompts_category_id_categories_id_fk";--> statement-breakpoint
DROP INDEX "prompts_category_id_index";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN "category_id";--> statement-breakpoint
-- The assigned-prompt visibility setting has nothing left to control.
DELETE FROM "settings" WHERE "key" = 'prompt_mode';
