ALTER TABLE "gemini_key_usage_events" ALTER COLUMN "input_tokens" SET DEFAULT 0;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_manager_candidate_normalized_url_unique" ON "jobs" USING btree ("manager_id","candidate_id",regexp_replace(split_part(btrim("job_url"), '#', 1), '/+$', ''));--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_manager_candidate_title_company_unique" ON "jobs" USING btree ("manager_id","candidate_id",lower(btrim("job_title")),lower(btrim("company")));--> statement-breakpoint
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
	v_usage_start timestamp with time zone;
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
	v_usage_start := LEAST(v_minute_start, v_day_start);

	DELETE FROM gemini_key_usage_events
	WHERE key_hash = p_key_hash
		AND occurred_at < v_usage_start;

	IF EXISTS (
		SELECT 1
		FROM gemini_key_busy_leases
		WHERE key_hash = p_key_hash AND expires_at > v_now
	) THEN
		RETURN NULL;
	END IF;

	SELECT
		(count(*) FILTER (WHERE occurred_at > v_minute_start))::integer,
		(count(*) FILTER (WHERE occurred_at >= v_day_start))::integer
	INTO v_minute_requests, v_day_requests
	FROM gemini_key_usage_events
	WHERE key_hash = p_key_hash
		AND occurred_at >= v_usage_start;

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
$$;--> statement-breakpoint
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
	v_usage_start timestamp with time zone;
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
	v_usage_start := LEAST(v_minute_start, v_day_start);

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
		(count(*) FILTER (WHERE occurred_at >= v_day_start))::integer
	INTO
		v_minute_requests,
		v_minute_input_tokens,
		v_day_requests
	FROM gemini_key_usage_events
	WHERE key_hash = p_key_hash
		AND occurred_at >= v_usage_start;

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
