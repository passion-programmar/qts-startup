ALTER TABLE "jobs" ADD COLUMN "generation_prompt_id" uuid;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_generation_prompt_id_prompts_id_fk"
  FOREIGN KEY ("generation_prompt_id") REFERENCES "public"."prompts"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
