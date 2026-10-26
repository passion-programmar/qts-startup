CREATE TABLE "apply_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"manager_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"browser_id" uuid,
	"status" text DEFAULT 'claimed' NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"submit_granted_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_reason" text,
	"confirmation_source" text,
	"screenshot_browser_name" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apply_attempts_status_check" CHECK ("apply_attempts"."status" in ('claimed', 'submitting', 'confirmed', 'not_confirmed', 'failed', 'released', 'skipped')),
	CONSTRAINT "apply_attempts_submit_audit_check" CHECK ("apply_attempts"."status" not in ('submitting', 'confirmed', 'not_confirmed') or "apply_attempts"."submit_granted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "candidate_saved_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_saved_answers_source_check" CHECK ("candidate_saved_answers"."source" in ('manager', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "extension_browsers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"browser_key" text NOT NULL,
	"name" text NOT NULL,
	"extension_version" text,
	"get_jd_on" boolean DEFAULT false NOT NULL,
	"work_mode" text DEFAULT 'off' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_browsers_work_mode_check" CHECK ("extension_browsers"."work_mode" in ('off', 'generation', 'apply'))
);
--> statement-breakpoint
CREATE TABLE "get_jd_page_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_id" uuid NOT NULL,
	"page_key" text NOT NULL,
	"status" text DEFAULT 'checking' NOT NULL,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "get_jd_page_checks_status_check" CHECK ("get_jd_page_checks"."status" in ('checking', 'done'))
);
--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "confirmation_status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "confirmation_source" text;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "apply_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "apply_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "bids" ADD COLUMN "screenshot_browser_name" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "generation_browser_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "work_authorization" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "needs_sponsorship" boolean;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "notice_period" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "salary_expectation_amount" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "salary_expectation_currency" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "salary_expectation_period" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "years_of_experience" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "willing_to_relocate" boolean;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "github_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "portfolio_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "eeo_preference" text DEFAULT 'prefer_not_to_say' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_use_apply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apply_ai_mode" text DEFAULT 'chatgpt' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "generation_stop_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apply_stop_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_candidate_id_profiles_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_browser_id_extension_browsers_id_fk" FOREIGN KEY ("browser_id") REFERENCES "public"."extension_browsers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_saved_answers" ADD CONSTRAINT "candidate_saved_answers_candidate_id_profiles_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_browsers" ADD CONSTRAINT "extension_browsers_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "get_jd_page_checks" ADD CONSTRAINT "get_jd_page_checks_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_attempts_one_live_per_job_unique" ON "apply_attempts" USING btree ("job_id") WHERE "apply_attempts"."status" in ('claimed', 'submitting');--> statement-breakpoint
CREATE UNIQUE INDEX "apply_attempts_one_live_per_candidate_unique" ON "apply_attempts" USING btree ("candidate_id") WHERE "apply_attempts"."status" in ('claimed', 'submitting');--> statement-breakpoint
CREATE INDEX "apply_attempts_manager_status_index" ON "apply_attempts" USING btree ("manager_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_saved_answers_question_unique" ON "candidate_saved_answers" USING btree ("candidate_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_browsers_manager_key_unique" ON "extension_browsers" USING btree ("manager_id","browser_key");--> statement-breakpoint
CREATE UNIQUE INDEX "get_jd_page_checks_manager_page_unique" ON "get_jd_page_checks" USING btree ("manager_id","page_key");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_generation_browser_id_extension_browsers_id_fk" FOREIGN KEY ("generation_browser_id") REFERENCES "public"."extension_browsers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_generation_per_browser_unique" ON "jobs" USING btree ("generation_browser_id") WHERE "jobs"."generation_status" = 'processing' and "jobs"."generation_browser_id" is not null;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_confirmation_status_check" CHECK ("bids"."confirmation_status" in ('confirmed', 'not_confirmed') and ("bids"."confirmation_source" is null or "bids"."confirmation_source" in ('page', 'email', 'manager')));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_salary_expectation_check" CHECK (("profiles"."salary_expectation_amount" is null or "profiles"."salary_expectation_amount" > 0) and ("profiles"."salary_expectation_period" is null or "profiles"."salary_expectation_period" in ('year', 'month', 'hour')));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_years_of_experience_check" CHECK ("profiles"."years_of_experience" is null or "profiles"."years_of_experience" between 0 and 70);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_eeo_preference_check" CHECK ("profiles"."eeo_preference" in ('prefer_not_to_say', 'answer_from_profile'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_apply_ai_mode_check" CHECK ("users"."apply_ai_mode" in ('chatgpt', 'gemini'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION claim_apply_attempt(
	p_manager_id uuid,
	p_browser_id uuid,
	p_limit integer,
	p_lease_seconds integer
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

	-- One claim at a time per Manager, so the limit and the one-per-candidate rule hold across Chromes.
	PERFORM pg_advisory_xact_lock(hashtextextended('apply:' || p_manager_id::text, 0));
	v_now := clock_timestamp();

	-- A Chrome that stopped renewing a claim before Submit gives the job back.
	UPDATE apply_attempts
	SET status = 'released', finished_at = v_now, updated_at = v_now,
		result_reason = coalesce(result_reason, 'The Chrome stopped before Submit; the job was returned.')
	WHERE manager_id = p_manager_id AND status = 'claimed' AND lease_expires_at < v_now;

	SELECT count(*)::integer INTO v_live
	FROM apply_attempts
	WHERE manager_id = p_manager_id AND status IN ('claimed', 'submitting');
	IF v_live >= p_limit THEN
		RETURN NULL;
	END IF;

	-- The oldest delivered Generation without a bid, whose job and candidate have no live attempt.
	SELECT j.id, j.candidate_id INTO v_job_id, v_candidate_id
	FROM jobs j
	JOIN users a ON a.id = j.candidate_id
	WHERE j.manager_id = p_manager_id
		AND j.generation_status = 'completed'
		AND j.resume_local_path IS NOT NULL
		AND j.status <> 'applied'
		AND a.role = 'account' AND a.parent_user_id = p_manager_id AND a.blocked_at IS NULL
		AND NOT EXISTS (
			SELECT 1 FROM bids b
			WHERE b.source_job_id = j.id
				OR (b.manager_id = j.manager_id AND b.candidate_id = j.candidate_id
					AND (regexp_replace(split_part(btrim(b.job_url), '#', 1), '/+$', '')
							= regexp_replace(split_part(btrim(j.job_url), '#', 1), '/+$', '')
						OR b.title_company_key = j.title_company_key))
		)
		AND NOT EXISTS (
			SELECT 1 FROM apply_attempts x
			WHERE (x.job_id = j.id AND x.status IN ('claimed', 'submitting', 'confirmed', 'not_confirmed', 'failed', 'skipped'))
				OR (x.candidate_id = j.candidate_id AND x.status IN ('claimed', 'submitting'))
		)
		-- A job returned twice before Submit (for example ChatGPT failing) waits for the Manager.
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
