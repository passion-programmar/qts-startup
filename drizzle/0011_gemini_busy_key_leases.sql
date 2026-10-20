CREATE TABLE IF NOT EXISTS "gemini_key_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gemini_key_usage_events_key_occurred_at_index" ON "gemini_key_usage_events" USING btree ("key_hash","occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gemini_key_busy_leases" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION try_acquire_gemini_key(
	p_key_hash text,
	p_max_requests_per_minute integer,
	p_max_requests_per_day integer
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
	v_now timestamp with time zone;
	v_minute_start timestamp with time zone;
	v_day_start timestamp with time zone;
	v_minute_requests integer;
	v_day_requests integer;
	v_lease_id uuid;
BEGIN
	IF p_max_requests_per_minute < 1 OR p_max_requests_per_day < 1 THEN
		RAISE EXCEPTION 'Gemini request limits must be positive.';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

	v_now := clock_timestamp();
	v_minute_start := v_now - interval '1 minute';
	v_day_start :=
		date_trunc('day', v_now AT TIME ZONE 'America/Los_Angeles')
		AT TIME ZONE 'America/Los_Angeles';

	DELETE FROM gemini_key_usage_events
	WHERE key_hash = p_key_hash
		AND occurred_at < v_day_start;

	IF EXISTS (
		SELECT 1
		FROM gemini_key_busy_leases
		WHERE key_hash = p_key_hash AND expires_at > v_now
	) THEN
		RETURN NULL;
	END IF;

	SELECT
		(count(*) FILTER (WHERE occurred_at > v_minute_start))::integer,
		count(*)::integer
	INTO v_minute_requests, v_day_requests
	FROM gemini_key_usage_events
	WHERE key_hash = p_key_hash
		AND occurred_at >= v_day_start;

	IF v_minute_requests >= p_max_requests_per_minute OR
		v_day_requests >= p_max_requests_per_day THEN
		RETURN NULL;
	END IF;

	v_lease_id := gen_random_uuid();
	INSERT INTO gemini_key_busy_leases (key_hash, lease_id, expires_at)
	VALUES (p_key_hash, v_lease_id, v_now + interval '2 minutes')
	ON CONFLICT (key_hash) DO UPDATE
	SET lease_id = EXCLUDED.lease_id, expires_at = EXCLUDED.expires_at;

	INSERT INTO gemini_key_usage_events (key_hash, input_tokens)
	VALUES (p_key_hash, 0);

	RETURN v_lease_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reserve_gemini_generation(
	p_key_hash text,
	p_lease_id uuid,
	p_input_tokens integer,
	p_max_requests_per_minute integer,
	p_max_requests_per_day integer,
	p_max_input_tokens_per_minute integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
	v_now timestamp with time zone;
	v_minute_start timestamp with time zone;
	v_day_start timestamp with time zone;
	v_minute_requests integer;
	v_minute_input_tokens integer;
	v_day_requests integer;
BEGIN
	IF p_input_tokens < 0 OR
		p_max_requests_per_minute < 1 OR
		p_max_requests_per_day < 1 OR
		p_max_input_tokens_per_minute < 1 THEN
		RAISE EXCEPTION 'Gemini request limits and input token count must be valid.';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
	v_now := clock_timestamp();
	v_minute_start := v_now - interval '1 minute';
	v_day_start :=
		date_trunc('day', v_now AT TIME ZONE 'America/Los_Angeles')
		AT TIME ZONE 'America/Los_Angeles';

	IF NOT EXISTS (
		SELECT 1
		FROM gemini_key_busy_leases
		WHERE key_hash = p_key_hash
			AND lease_id = p_lease_id
			AND expires_at > v_now
	) THEN
		RETURN false;
	END IF;

	SELECT
		(count(*) FILTER (WHERE occurred_at > v_minute_start))::integer,
		(COALESCE(sum(input_tokens) FILTER (WHERE occurred_at > v_minute_start), 0))::integer,
		count(*)::integer
	INTO
		v_minute_requests,
		v_minute_input_tokens,
		v_day_requests
	FROM gemini_key_usage_events
	WHERE key_hash = p_key_hash
		AND occurred_at >= v_day_start;

	IF v_minute_requests >= p_max_requests_per_minute OR
		v_day_requests >= p_max_requests_per_day OR
		p_input_tokens > p_max_input_tokens_per_minute OR
		v_minute_input_tokens + p_input_tokens > p_max_input_tokens_per_minute THEN
		RETURN false;
	END IF;

	INSERT INTO gemini_key_usage_events (key_hash, input_tokens)
	VALUES (p_key_hash, p_input_tokens);

	UPDATE gemini_key_busy_leases
	SET expires_at = v_now + interval '2 minutes'
	WHERE key_hash = p_key_hash AND lease_id = p_lease_id;

	RETURN true;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION release_gemini_key(
	p_key_hash text,
	p_lease_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
	DELETE FROM gemini_key_busy_leases
	WHERE key_hash = p_key_hash AND lease_id = p_lease_id;
END;
$$;
