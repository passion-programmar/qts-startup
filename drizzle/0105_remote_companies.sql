CREATE TABLE "remote_company_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_key" text NOT NULL,
	"title_key" text NOT NULL,
	"company" text NOT NULL,
	"job_title" text NOT NULL,
	"places" text[] DEFAULT '{}'::text[] NOT NULL,
	"job_count" integer DEFAULT 0 NOT NULL,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_view_remote_companies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "remote_company_jobs_company_title_unique" ON "remote_company_jobs" USING btree ("company_key","title_key");--> statement-breakpoint
CREATE INDEX "remote_company_jobs_last_seen_at_index" ON "remote_company_jobs" USING btree ("last_seen_at");
--> statement-breakpoint
-- Remote companies (src/db/schema.ts remoteCompanyJobs). Fully remote: the place or the work
-- arrangement says "remote" as a word, and neither says hybrid or on-site ("Slovakia (Remote)",
-- "Remote", "Full-time · Remote" yes; "Essen, remote" marked Hybrid no).
CREATE OR REPLACE FUNCTION qts_is_fully_remote(p_place text, p_arrangement text) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT coalesce(
		concat_ws(' ', p_place, p_arrangement) ~* '\mremote\M'
		AND concat_ws(' ', p_place, p_arrangement) !~* '\m(hybrid|on-?site|in-?office|in office|partly remote)\M',
		false
	)
$$;
--> statement-breakpoint
-- One sighting of a remote job. p_key is computeTitleCompanyKey's "title|company" (neither half can
-- hold "|"). The row's company and title follow the newest sighting; a place is added once (case
-- ignored, at most 30); the counts add up; first and last seen widen.
CREATE OR REPLACE FUNCTION qts_record_remote_job(
	p_key text,
	p_company text,
	p_title text,
	p_place text,
	p_jobs integer,
	p_bids integer,
	p_at timestamp with time zone
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	v_title_key text := split_part(coalesce(p_key, ''), '|', 1);
	v_company_key text := split_part(coalesce(p_key, ''), '|', 2);
	v_place text := left(coalesce(nullif(btrim(regexp_replace(coalesce(p_place, ''), '\s+', ' ', 'g')), ''), 'Remote'), 120);
	v_at timestamp with time zone := coalesce(p_at, now());
BEGIN
	IF v_title_key = '' OR v_company_key = '' OR btrim(coalesce(p_company, '')) = '' OR btrim(coalesce(p_title, '')) = '' THEN
		RETURN;
	END IF;
	INSERT INTO remote_company_jobs AS r
		(company_key, title_key, company, job_title, places, job_count, bid_count, first_seen_at, last_seen_at)
	VALUES
		(v_company_key, v_title_key, left(btrim(p_company), 200), left(btrim(p_title), 300), ARRAY[v_place], p_jobs, p_bids, v_at, v_at)
	ON CONFLICT (company_key, title_key) DO UPDATE SET
		company = CASE WHEN EXCLUDED.last_seen_at >= r.last_seen_at THEN EXCLUDED.company ELSE r.company END,
		job_title = CASE WHEN EXCLUDED.last_seen_at >= r.last_seen_at THEN EXCLUDED.job_title ELSE r.job_title END,
		places = CASE
			WHEN cardinality(r.places) >= 30 OR EXISTS (SELECT 1 FROM unnest(r.places) AS p(place) WHERE lower(p.place) = lower(v_place))
				THEN r.places
			ELSE r.places || v_place
		END,
		job_count = r.job_count + EXCLUDED.job_count,
		bid_count = r.bid_count + EXCLUDED.bid_count,
		first_seen_at = least(r.first_seen_at, EXCLUDED.first_seen_at),
		last_seen_at = greatest(r.last_seen_at, EXCLUDED.last_seen_at);
END;
$$;
--> statement-breakpoint
-- Guarded: any problem here is only a warning, so saving a job never fails because of this list.
-- An update counts as a new save only when the job was not a remote job under this key before.
CREATE OR REPLACE FUNCTION qts_remote_companies_from_job() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	BEGIN
		IF NOT qts_is_fully_remote(NEW.location, NEW.workplace_type) THEN
			RETURN NULL;
		END IF;
		IF TG_OP = 'UPDATE'
			AND OLD.title_company_key IS NOT DISTINCT FROM NEW.title_company_key
			AND OLD.location IS NOT DISTINCT FROM NEW.location
			AND OLD.workplace_type IS NOT DISTINCT FROM NEW.workplace_type
			AND OLD.company IS NOT DISTINCT FROM NEW.company
			AND OLD.job_title IS NOT DISTINCT FROM NEW.job_title THEN
			RETURN NULL;
		END IF;
		PERFORM qts_record_remote_job(
			NEW.title_company_key, NEW.company, NEW.job_title, NEW.location,
			CASE
				WHEN TG_OP = 'INSERT'
					OR OLD.title_company_key IS DISTINCT FROM NEW.title_company_key
					OR NOT qts_is_fully_remote(OLD.location, OLD.workplace_type) THEN 1
				ELSE 0
			END,
			0,
			now()
		);
	EXCEPTION WHEN OTHERS THEN
		RAISE WARNING 'remote companies (job): % %', SQLSTATE, SQLERRM;
	END;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION qts_remote_companies_from_bid() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	BEGIN
		IF qts_is_fully_remote(NEW.location, NEW.work_type) THEN
			PERFORM qts_record_remote_job(NEW.title_company_key, NEW.company, NEW.job_title, NEW.location, 0, 1, coalesce(NEW.applied_at, now()));
		END IF;
	EXCEPTION WHEN OTHERS THEN
		RAISE WARNING 'remote companies (bid): % %', SQLSTATE, SQLERRM;
	END;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
-- The WHEN clauses are a cheap first filter: most saves that do not mention remote never call the functions.
DROP TRIGGER IF EXISTS remote_companies_from_job ON jobs;
--> statement-breakpoint
CREATE TRIGGER remote_companies_from_job
	AFTER INSERT OR UPDATE OF location, workplace_type, company, job_title, title_company_key ON jobs
	FOR EACH ROW
	WHEN (NEW.title_company_key IS NOT NULL AND (NEW.location ~* 'remote' OR NEW.workplace_type ~* 'remote'))
	EXECUTE FUNCTION qts_remote_companies_from_job();
--> statement-breakpoint
DROP TRIGGER IF EXISTS remote_companies_from_bid ON bids;
--> statement-breakpoint
CREATE TRIGGER remote_companies_from_bid
	AFTER INSERT ON bids
	FOR EACH ROW
	WHEN (NEW.title_company_key IS NOT NULL AND (NEW.location ~* 'remote' OR NEW.work_type ~* 'remote'))
	EXECUTE FUNCTION qts_remote_companies_from_bid();
--> statement-breakpoint
-- One-time backfill: every remote job and bid already in QTS, oldest first, through the same function.
DO $$
DECLARE
	v_row record;
BEGIN
	FOR v_row IN
		SELECT title_company_key AS key, company, job_title, location, 1 AS jobs, 0 AS bids, created_at AS at
		FROM jobs
		WHERE title_company_key IS NOT NULL AND qts_is_fully_remote(location, workplace_type)
		UNION ALL
		SELECT title_company_key, company, job_title, location, 0, 1, applied_at
		FROM bids
		WHERE title_company_key IS NOT NULL AND qts_is_fully_remote(location, work_type)
		ORDER BY at
	LOOP
		PERFORM qts_record_remote_job(v_row.key, v_row.company, v_row.job_title, v_row.location, v_row.jobs, v_row.bids, v_row.at);
	END LOOP;
END;
$$;
