CREATE TABLE "extension_page_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"url_rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_manage_page_exclusions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "extension_page_exclusions" ADD CONSTRAINT "extension_page_exclusions_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extension_page_exclusions_manager_url_unique" ON "extension_page_exclusions" USING btree ("manager_id","url_rule");--> statement-breakpoint
CREATE INDEX "extension_page_exclusions_manager_id_index" ON "extension_page_exclusions" USING btree ("manager_id");