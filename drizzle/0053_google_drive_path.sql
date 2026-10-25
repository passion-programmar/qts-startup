ALTER TABLE "bids" ADD COLUMN "google_drive_path" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "google_drive_path" text;--> statement-breakpoint
-- bids.googledriver_path is renamed to google_drive_path; 0054 drops the old column.
UPDATE "bids" SET "google_drive_path" = "googledriver_path" WHERE "googledriver_path" IS NOT NULL;--> statement-breakpoint
-- jobs.country is folded into location before 0054 drops it: location only, everywhere.
UPDATE "jobs" SET "location" = CASE
    WHEN nullif(btrim("location"), '') IS NULL THEN btrim("country")
    ELSE btrim("location") || ', ' || btrim("country")
  END
 WHERE nullif(btrim("country"), '') IS NOT NULL
   AND (nullif(btrim("location"), '') IS NULL
        OR position(lower(btrim("country")) in lower("location")) = 0);
