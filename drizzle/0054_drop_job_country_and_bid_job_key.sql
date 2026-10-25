DROP INDEX "bids_manager_job_key_index";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "job_key";--> statement-breakpoint
ALTER TABLE "bids" DROP COLUMN "googledriver_path";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "country";--> statement-breakpoint
-- Jobs keep only location (with the country inside it): the default Get JD prompt
-- asks Gemini for location instead of a separate country.
DO $$
DECLARE
	current_prompt prompts%ROWTYPE;
	new_prompt_id uuid := gen_random_uuid();
	next_version integer;
	updated_prompt text;
BEGIN
	SELECT *
	INTO current_prompt
	FROM prompts
	WHERE provider = 'gemini'
		AND purpose = 'job_description_evaluation'
		AND is_active
		AND is_default
		AND prompt_template NOT ILIKE '%separate country field%'
	ORDER BY updated_at DESC
	LIMIT 1
	FOR UPDATE;

	IF NOT FOUND THEN
		RETURN;
	END IF;

	updated_prompt := regexp_replace(
		current_prompt.prompt_template,
		', location, country,',
		', location (city, region and country as written),',
		'gi'
	);
	updated_prompt := regexp_replace(
		updated_prompt,
		', country,',
		', location (city, region and country as written),',
		'gi'
	);
	updated_prompt := regexp_replace(
		updated_prompt,
		E'\r?\n[ \t]*- Do not include `location` or `jobUrl` in the JSON response[^\r\n]*',
		'',
		'gi'
	);
	updated_prompt := regexp_replace(
		updated_prompt,
		E'\r?\n[ \t]*"country":[^\r\n]*',
		'',
		'gi'
	);
	updated_prompt := updated_prompt || E'\n\n- Put the job''s city, region and country together in `location`, as written in the posting. Do not return a separate country field or `jobUrl`; the server uses the supplied page URL.';

	SELECT COALESCE(MAX(version), 0) + 1
	INTO next_version
	FROM prompts
	WHERE prompt_group_id = current_prompt.prompt_group_id;

	UPDATE prompts
	SET is_active = false,
		is_default = false,
		updated_at = now()
	WHERE id = current_prompt.id;

	INSERT INTO prompts (
		id,
		prompt_group_id,
		provider,
		purpose,
		name,
		prompt_template,
		version,
		is_active,
		is_default,
		created_by_user_id
	) VALUES (
		new_prompt_id,
		current_prompt.prompt_group_id,
		current_prompt.provider,
		current_prompt.purpose,
		current_prompt.name,
		updated_prompt,
		next_version,
		true,
		true,
		current_prompt.created_by_user_id
	);

	UPDATE manager_prompt_assignments
	SET prompt_id = new_prompt_id
	WHERE prompt_id = current_prompt.id;
END
$$;
