ALTER TABLE "gemini_api_call_logs" ADD COLUMN "local_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "gemini_api_call_logs" ADD COLUMN "gemini_input_tokens" integer;