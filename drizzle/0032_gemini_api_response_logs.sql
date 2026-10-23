CREATE TABLE "gemini_api_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"response_body" text,
	"response_truncated" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "gemini_api_call_logs_operation_check" CHECK ("operation" IN ('generate_content', 'count_tokens')),
	CONSTRAINT "gemini_api_call_logs_status_check" CHECK ("status" IN ('pending', 'http_success', 'http_error', 'network_error'))
);
--> statement-breakpoint
CREATE INDEX "gemini_api_call_logs_key_started_at_index" ON "gemini_api_call_logs" USING btree ("key_hash", "started_at");
