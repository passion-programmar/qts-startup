CREATE TABLE "linkedin_skips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"skip_key" text NOT NULL,
	"company" text NOT NULL,
	"job_title" text NOT NULL,
	"source" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linkedin_skips_source_check" CHECK ("linkedin_skips"."source" in ('clicked', 'viewed', 'saved', 'applied', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "linkedin_skips" ADD CONSTRAINT "linkedin_skips_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linkedin_skips_manager_key_unique" ON "linkedin_skips" USING btree ("manager_id","skip_key");--> statement-breakpoint
CREATE INDEX "linkedin_skips_manager_updated_at_index" ON "linkedin_skips" USING btree ("manager_id","updated_at");