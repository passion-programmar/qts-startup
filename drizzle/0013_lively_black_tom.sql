CREATE TABLE "login_rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_rate_limit_events_key_occurred_at_index" ON "login_rate_limit_events" USING btree ("key_hash","occurred_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION consume_login_rate_limit(
	p_key_hash text,
	p_maximum_attempts integer,
	p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
	v_now timestamp with time zone;
	v_window_start timestamp with time zone;
	v_attempt_count integer;
BEGIN
	IF p_maximum_attempts < 1 OR p_window_seconds < 1 THEN
		RAISE EXCEPTION 'Login rate-limit values must be positive.';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended(p_key_hash, 1));
	v_now := clock_timestamp();
	v_window_start := v_now - make_interval(secs => p_window_seconds);

	DELETE FROM login_rate_limit_events
	WHERE occurred_at < v_window_start;

	SELECT count(*)::integer
	INTO v_attempt_count
	FROM login_rate_limit_events
	WHERE key_hash = p_key_hash AND occurred_at >= v_window_start;

	IF v_attempt_count >= p_maximum_attempts THEN
		RETURN false;
	END IF;

	INSERT INTO login_rate_limit_events (key_hash, occurred_at)
	VALUES (p_key_hash, v_now);
	RETURN true;
END;
$$;
