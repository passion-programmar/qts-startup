ALTER TABLE "linkedin_skips" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_use_linkedin_skips" boolean DEFAULT true NOT NULL;