ALTER TABLE "interviews" ADD COLUMN "track_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "interviews_manager_track_index" ON "interviews" USING btree ("manager_id","track_id","starts_at");--> statement-breakpoint
-- Rounds of the same bid form one track (the bid's id); rounds entered by hand keep their own.
UPDATE "interviews" SET "track_id" = "bid_id" WHERE "bid_id" IS NOT NULL;
