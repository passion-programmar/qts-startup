CREATE TABLE "extension_job_detection_url_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"url_rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_manage_job_detection_url_rules" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "extension_job_detection_url_rules" ADD CONSTRAINT "extension_job_detection_url_rules_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extension_job_detection_url_rules_manager_url_unique" ON "extension_job_detection_url_rules" USING btree ("manager_id","url_rule");--> statement-breakpoint
CREATE INDEX "extension_job_detection_url_rules_manager_id_index" ON "extension_job_detection_url_rules" USING btree ("manager_id");