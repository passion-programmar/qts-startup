ALTER TABLE "interviews" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
-- Rounds saved so far are Romania wall-clock date and times; a round without an end is an hour long.
UPDATE "interviews" SET "starts_at" = ("interview_date" + "interview_time"::time) AT TIME ZONE 'Europe/Bucharest', "ends_at" = CASE WHEN "interview_end_time" IS NULL THEN (("interview_date" + "interview_time"::time) AT TIME ZONE 'Europe/Bucharest') + interval '1 hour' ELSE ("interview_date" + "interview_end_time"::time) AT TIME ZONE 'Europe/Bucharest' END;
