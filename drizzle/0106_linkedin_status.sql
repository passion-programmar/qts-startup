ALTER TABLE "profiles" ADD COLUMN "linkedin_status" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "linkedin_status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_linkedin_status_check" CHECK ("profiles"."linkedin_status" in ('live', 'applying', 'blocked'));