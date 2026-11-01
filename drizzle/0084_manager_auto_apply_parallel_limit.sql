-- Managers configure the number of Auto Apply forms opened together by each Chrome.
ALTER TABLE "users" ADD COLUMN "auto_apply_parallel_limit" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auto_apply_parallel_limit_check" CHECK ("users"."auto_apply_parallel_limit" between 1 and 10);