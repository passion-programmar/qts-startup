CREATE TYPE "public"."prompt_provider" AS ENUM('openai', 'gemini');--> statement-breakpoint
CREATE TYPE "public"."prompt_purpose" AS ENUM('document_generation', 'job_description_evaluation', 'application_answer');--> statement-breakpoint
CREATE TABLE "manager_prompt_assignments" (
	"manager_id" uuid PRIMARY KEY NOT NULL,
	"prompt_id" uuid NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_prompt_overrides" (
	"manager_id" uuid PRIMARY KEY NOT NULL,
	"prompt_template" text NOT NULL,
	"based_on_prompt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "prompt_provider" NOT NULL,
	"purpose" "prompt_purpose" NOT NULL,
	"name" text NOT NULL,
	"prompt_template" text NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_version_positive_check" CHECK ("prompts"."version" > 0),
	CONSTRAINT "prompts_provider_matches_purpose_check" CHECK (("prompts"."provider" = 'openai' and "prompts"."purpose" = 'document_generation') or ("prompts"."provider" = 'gemini' and "prompts"."purpose" in ('job_description_evaluation', 'application_answer')))
);
--> statement-breakpoint
ALTER TABLE "manager_prompt_assignments" ADD CONSTRAINT "manager_prompt_assignments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_prompt_assignments" ADD CONSTRAINT "manager_prompt_assignments_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_prompt_assignments" ADD CONSTRAINT "manager_prompt_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_prompt_overrides" ADD CONSTRAINT "manager_prompt_overrides_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_prompt_overrides" ADD CONSTRAINT "manager_prompt_overrides_based_on_prompt_id_prompts_id_fk" FOREIGN KEY ("based_on_prompt_id") REFERENCES "public"."prompts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_provider_purpose_version_unique" ON "prompts" USING btree ("provider","purpose","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_one_active_per_provider_purpose_unique" ON "prompts" USING btree ("provider","purpose") WHERE "prompts"."is_active";