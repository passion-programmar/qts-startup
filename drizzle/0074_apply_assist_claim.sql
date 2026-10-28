-- Apply as the Manager's assistant (extension 1.41.0): each Chrome keeps up to p_limit job pages open
-- at once (two), and any number of Chromes work at the same time, so the limit is per Chrome, not
-- per Manager. A candidate may have several of them open. Jobs this Chrome cancelled since Apply was
-- turned on (p_skip_job_ids) are not handed to it again; they stay in the list for later.
DROP FUNCTION IF EXISTS claim_apply_attempt(uuid, uuid, integer, integer);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION claim_apply_attempt(
	p_manager_id uuid,
	p_browser_id uuid,
	p_limit integer,
	p_lease_seconds integer,
	p_skip_job_ids uuid[] DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
	v_now timestamp with time zone;
	v_live integer;
	v_job_id uuid;
	v_candidate_id uuid;
	v_attempt_id uuid;
BEGIN
	IF p_limit < 1 OR p_lease_seconds < 1 THEN
		RAISE EXCEPTION 'Apply claim limits must be positive.';
	END IF;

	-- One claim at a time per Manager, so two Chromes never take the same job.
	PERFORM pg_advisory_xact_lock(hashtextextended('apply:' || p_manager_id::text, 0));
	v_now := clock_timestamp();

	-- A Chrome that stopped renewing a claim, while filling or in review, gives the job back.
	UPDATE apply_attempts
	SET status = 'released', finished_at = v_now, updated_at = v_now,
		result_reason = coalesce(result_reason, CASE WHEN status = 'waiting_review'
			THEN 'The Chrome closed during review; the job was returned.'
			ELSE 'The Chrome stopped before Submit; the job was returned.' END)
	WHERE manager_id = p_manager_id AND status IN ('claimed', 'waiting_review') AND lease_expires_at < v_now;

	-- This Chrome's open job pages, up to the limit.
	SELECT count(*)::integer INTO v_live
	FROM apply_attempts
	WHERE browser_id = p_browser_id
		AND (status IN ('claimed', 'waiting_review', 'submitting')
			OR (status = 'waiting_confirmation' AND lease_expires_at > v_now));
	IF v_live >= p_limit THEN
		RETURN NULL;
	END IF;

	-- The oldest delivered Generation the candidate has not applied to, with no attempt holding it.
	SELECT j.id, j.candidate_id INTO v_job_id, v_candidate_id
	FROM jobs j
	JOIN users a ON a.id = j.candidate_id
	WHERE j.manager_id = p_manager_id
		AND j.generation_status = 'completed'
		AND j.resume_local_path IS NOT NULL
		AND j.status <> 'applied'
		AND NOT (j.id = ANY(coalesce(p_skip_job_ids, '{}')))
		AND a.role = 'account' AND a.parent_user_id = p_manager_id AND a.blocked_at IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM bids b
			WHERE b.manager_id = j.manager_id AND b.candidate_id = j.candidate_id
				AND (regexp_replace(split_part(btrim(b.job_url), '#', 1), '/+$', '')
						= regexp_replace(split_part(btrim(j.job_url), '#', 1), '/+$', '')
					OR b.title_company_key = j.title_company_key)
		)
		AND NOT EXISTS (
			SELECT 1 FROM apply_attempts x
			WHERE x.job_id = j.id AND x.status IN ('claimed', 'waiting_review', 'waiting_confirmation', 'submitting',
				'confirmed', 'not_confirmed', 'failed', 'skipped')
		)
		-- A job returned twice before review (for example the page not loading) waits for "Apply again".
		AND (SELECT count(*) FROM apply_attempts r WHERE r.job_id = j.id AND r.status = 'released') < 2
	ORDER BY (
		SELECT max(g.created_at) FROM generation_runs g WHERE g.job_id = j.id AND g.status = 'delivered'
	) ASC NULLS LAST, j.created_at ASC, j.id ASC
	LIMIT 1;

	IF v_job_id IS NULL THEN
		RETURN NULL;
	END IF;

	INSERT INTO apply_attempts (job_id, manager_id, candidate_id, browser_id, status, lease_expires_at)
	VALUES (v_job_id, p_manager_id, v_candidate_id, p_browser_id, 'claimed',
		v_now + make_interval(secs => p_lease_seconds))
	RETURNING id INTO v_attempt_id;
	RETURN v_attempt_id;
END;
$$;
