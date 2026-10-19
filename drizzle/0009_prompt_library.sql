DROP INDEX "prompts_provider_purpose_version_unique";--> statement-breakpoint
DROP INDEX "prompts_one_active_per_provider_purpose_unique";--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "prompt_group_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_group_version_unique" ON "prompts" USING btree ("prompt_group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_one_active_version_per_group_unique" ON "prompts" USING btree ("prompt_group_id") WHERE "prompts"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_one_default_per_provider_purpose_unique" ON "prompts" USING btree ("provider","purpose") WHERE "prompts"."is_default";