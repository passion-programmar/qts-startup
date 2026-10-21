ALTER TABLE "profiles" DROP CONSTRAINT "profiles_pdf_template_check";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "pdf_template" SET DEFAULT 'heritage';--> statement-breakpoint
UPDATE "profiles"
SET "pdf_template" = CASE "pdf_template"
	WHEN 'modern' THEN 'indigo'
	WHEN 'compact' THEN 'vellum'
	ELSE 'heritage'
END
WHERE "pdf_template" IN ('professional', 'modern', 'compact');--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_pdf_template_check" CHECK ("profiles"."pdf_template" in ('heritage', 'laurel', 'vellum', 'pewter', 'regent', 'orchid', 'onyx', 'palette', 'ivory', 'azure', 'pillar', 'barrister', 'indigo', 'amber-crest', 'garnet', 'reef', 'verdant', 'parchment', 'vanguard', 'axis', 'admiral', 'seafoam', 'ember', 'terminal', 'aurelia', 'portrait', 'basalt', 'ripple', 'meridian', 'sentinel'));
