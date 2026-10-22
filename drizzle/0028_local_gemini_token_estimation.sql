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

	-- Acquiring a lease is local work and no longer represents a Gemini API
	-- request. reserve_gemini_generation records the single generateContent
	-- request together with the server-estimated input-token count.
	RETURN v_lease_id;
END;
$$;
