CREATE TABLE "auto_apply_custom_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"url_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_apply_custom_urls" ADD CONSTRAINT "auto_apply_custom_urls_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_apply_custom_urls_manager_prefix_unique" ON "auto_apply_custom_urls" USING btree ("manager_id","url_prefix");--> statement-breakpoint
CREATE INDEX "auto_apply_custom_urls_manager_id_index" ON "auto_apply_custom_urls" USING btree ("manager_id");