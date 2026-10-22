CREATE TABLE "text_highlight_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"text_color" text NOT NULL,
	"background_color" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_manage_text_highlights" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "text_highlight_rules" ADD CONSTRAINT "text_highlight_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "text_highlight_rules_text_normalized_unique" ON "text_highlight_rules" USING btree (lower(btrim("text")));