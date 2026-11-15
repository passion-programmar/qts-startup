ALTER TABLE "interviews" DROP CONSTRAINT "interviews_time_format";--> statement-breakpoint
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_end_time_after_start";--> statement-breakpoint
DROP INDEX "interviews_manager_date_time_index";--> statement-breakpoint
DROP INDEX "interviews_bid_step_date_unique";--> statement-breakpoint
ALTER TABLE "interviews" ALTER COLUMN "starts_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ALTER COLUMN "ends_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "interviews_manager_starts_at_index" ON "interviews" USING btree ("manager_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_bid_step_starts_at_unique" ON "interviews" USING btree ("bid_id","step","starts_at");--> statement-breakpoint
ALTER TABLE "interviews" DROP COLUMN "interview_date";--> statement-breakpoint
ALTER TABLE "interviews" DROP COLUMN "interview_time";--> statement-breakpoint
ALTER TABLE "interviews" DROP COLUMN "interview_end_time";--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_ends_after_start" CHECK ("interviews"."ends_at" > "interviews"."starts_at");