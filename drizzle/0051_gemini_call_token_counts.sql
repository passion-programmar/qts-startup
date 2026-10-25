ALTER TABLE "gemini_api_call_logs" ADD COLUMN "local_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "gemini_api_call_logs" ADD COLUMN "gemini_input_tokens" integer;--> statement-breakpoint
CREATE INDEX "gemini_api_call_logs_started_at_index" ON "gemini_api_call_logs" USING btree ("started_at");