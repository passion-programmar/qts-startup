CREATE TABLE "useful_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_key" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "useful_prompts_version_positive" CHECK ("useful_prompts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "useful_prompts" ADD CONSTRAINT "useful_prompts_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "useful_prompts_key_version_unique" ON "useful_prompts" USING btree ("prompt_key","version");--> statement-breakpoint
CREATE INDEX "useful_prompts_manager_index" ON "useful_prompts" USING btree ("manager_id");