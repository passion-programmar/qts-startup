ALTER TABLE "bids" ADD COLUMN "custom_kind" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "custom_note" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "custom_kind" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "custom_note" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "pinned_browser_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pinned_browser_id_extension_browsers_id_fk" FOREIGN KEY ("pinned_browser_id") REFERENCES "public"."extension_browsers"("id") ON DELETE set null ON UPDATE no action;