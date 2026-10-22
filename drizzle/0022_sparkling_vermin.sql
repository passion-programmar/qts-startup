ALTER TABLE "profiles" DROP CONSTRAINT "profiles_pdf_template_check";--> statement-breakpoint
UPDATE "profiles"
SET "pdf_template" = 'heritage'
WHERE "pdf_template" IN (
	'orchid', 'ivory', 'azure', 'pillar', 'barrister', 'parchment',
	'vanguard', 'axis', 'admiral', 'seafoam', 'aurelia', 'portrait',
	'basalt', 'ripple', 'sentinel'
);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_pdf_template_check" CHECK ("profiles"."pdf_template" in ('heritage', 'laurel', 'vellum', 'pewter', 'regent', 'onyx', 'palette', 'indigo', 'amber-crest', 'garnet', 'reef', 'verdant', 'ember', 'terminal', 'meridian'));
