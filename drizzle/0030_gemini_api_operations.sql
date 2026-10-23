ALTER TABLE "gemini_key_usage_events"
ADD COLUMN "operation" text DEFAULT 'generate_content' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gemini_key_usage_events"
ADD CONSTRAINT "gemini_key_usage_events_operation_check"
CHECK ("operation" IN ('generate_content', 'count_tokens'));
