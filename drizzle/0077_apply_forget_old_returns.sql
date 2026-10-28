-- Apply records nothing when a Chrome stops (0075): an application whose Chrome closed, reloaded, or
-- slept is removed, never counted as returned. Returns the old rule (0074 and before) counted for
-- that reason are removed too, so a job held back after "two returns" by them is offered again.
-- Returns for real errors (the page not loading, ...) and skips stay.
DELETE FROM apply_attempts
WHERE status = 'released'
	AND result_reason IN (
		'The Chrome closed during review; the job was returned.',
		'The Chrome stopped before Submit; the job was returned.'
	);
