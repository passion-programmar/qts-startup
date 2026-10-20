CREATE TABLE "gemini_key_usage" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"minute_window_start" timestamp with time zone NOT NULL,
	"minute_requests" integer DEFAULT 0 NOT NULL,
	"minute_input_tokens" integer DEFAULT 0 NOT NULL,
	"day_window_start" timestamp with time zone NOT NULL,
	"day_requests" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION reserve_gemini_api_call(
	p_key_hash text,
	p_input_tokens integer,
	p_max_requests_per_minute integer,
	p_max_requests_per_day integer,
	p_max_input_tokens_per_minute integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
	v_minute_start timestamp with time zone;
	v_day_start timestamp with time zone;
	v_minute_window_start timestamp with time zone;
	v_minute_requests integer;
	v_minute_input_tokens integer;
	v_day_window_start timestamp with time zone;
	v_day_requests integer;
BEGIN
	IF p_input_tokens < 0 OR
		p_max_requests_per_minute < 1 OR
		p_max_requests_per_day < 1 OR
		p_max_input_tokens_per_minute < 1 THEN
		RAISE EXCEPTION 'Gemini usage limits and token counts must be positive.';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

	v_minute_start := date_trunc('minute', statement_timestamp());
	v_day_start :=
		date_trunc('day', statement_timestamp() AT TIME ZONE 'America/Los_Angeles')
		AT TIME ZONE 'America/Los_Angeles';

	INSERT INTO gemini_key_usage (
		key_hash,
		minute_window_start,
		day_window_start
	)
	VALUES (p_key_hash, v_minute_start, v_day_start)
	ON CONFLICT (key_hash) DO NOTHING;

	SELECT
		minute_window_start,
		minute_requests,
		minute_input_tokens,
		day_window_start,
		day_requests
	INTO
		v_minute_window_start,
		v_minute_requests,
		v_minute_input_tokens,
		v_day_window_start,
		v_day_requests
	FROM gemini_key_usage
	WHERE key_hash = p_key_hash
	FOR UPDATE;

	IF v_minute_window_start <> v_minute_start THEN
		v_minute_requests := 0;
		v_minute_input_tokens := 0;
	END IF;
	IF v_day_window_start <> v_day_start THEN
		v_day_requests := 0;
	END IF;

	IF v_minute_requests >= p_max_requests_per_minute OR
		v_day_requests >= p_max_requests_per_day OR
		p_input_tokens > p_max_input_tokens_per_minute OR
		v_minute_input_tokens + p_input_tokens > p_max_input_tokens_per_minute THEN
		RETURN false;
	END IF;

	UPDATE gemini_key_usage
	SET
		minute_window_start = v_minute_start,
		minute_requests = v_minute_requests + 1,
		minute_input_tokens = v_minute_input_tokens + p_input_tokens,
		day_window_start = v_day_start,
		day_requests = v_day_requests + 1,
		updated_at = statement_timestamp()
	WHERE key_hash = p_key_hash;

	RETURN true;
END;
$$;
