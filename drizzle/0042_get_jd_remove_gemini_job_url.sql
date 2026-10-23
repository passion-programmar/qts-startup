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
		AND prompt_template ILIKE '%jobUrl%'
	ORDER BY updated_at DESC
	LIMIT 1
	FOR UPDATE;

	IF NOT FOUND THEN
		RETURN;
	END IF;

	updated_prompt := regexp_replace(
		current_prompt.prompt_template,
		E'\\r?\\n[ \\t]*- Set `?jobUrl`? to the supplied primary webpage URL\\.',
		'',
		'g'
	);
	updated_prompt := regexp_replace(
		updated_prompt,
		E',\\r?\\n[ \\t]*"jobUrl":[^\\r\\n]*',
		'',
		'g'
	);
	updated_prompt := regexp_replace(
		updated_prompt,
		', location, country',
		', country',
		'gi'
	);
	updated_prompt := regexp_replace(
		updated_prompt,
		E'\\r?\\n[ \\t]*"location":[^\\r\\n]*',
		'',
		'gi'
	);
	updated_prompt := updated_prompt || E'\n\n- Do not include `location` or `jobUrl` in the JSON response; the server uses the supplied page URL, and location is not part of this response schema.';

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
