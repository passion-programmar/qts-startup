-- Notice period is now one of two choices: a saved "1 week" (or "7 days") stays 1 week, anything else becomes immediately.
UPDATE "profiles" SET "notice_period" = CASE WHEN "notice_period" ~* '^[[:space:]]*(1|one)[[:space:]]*week|^[[:space:]]*7[[:space:]]*days' THEN '1_week' ELSE 'immediately' END;--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_salary_expectation_check";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "notice_period" SET DEFAULT 'immediately';--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "notice_period" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_notice_period_check" CHECK ("profiles"."notice_period" in ('immediately', '1_week'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_salary_expectation_check" CHECK (("profiles"."salary_expectation_amount" is null or "profiles"."salary_expectation_amount" > 0) and ("profiles"."salary_expectation_period" is null or "profiles"."salary_expectation_period" in ('year', 'month', 'day', 'hour')));