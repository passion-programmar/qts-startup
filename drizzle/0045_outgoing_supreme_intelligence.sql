ALTER TABLE "profiles" DROP CONSTRAINT "profiles_pdf_template_check";--> statement-breakpoint
UPDATE "profiles"
SET "pdf_template" = CASE "pdf_template"
  WHEN 'heritage' THEN 'classic'
  WHEN 'laurel' THEN 'nordic'
  WHEN 'vellum' THEN 'centered'
  WHEN 'pewter' THEN 'graphite'
  WHEN 'regent' THEN 'professional'
  WHEN 'onyx' THEN 'high-contrast'
  WHEN 'palette' THEN 'creative'
  WHEN 'indigo' THEN 'slate'
  WHEN 'amber-crest' THEN 'bold'
  WHEN 'garnet' THEN 'modern-serif'
  WHEN 'reef' THEN 'startup'
  WHEN 'verdant' THEN 'timeline'
  WHEN 'ember' THEN 'bold'
  WHEN 'terminal' THEN 'technical'
  WHEN 'meridian' THEN 'minimal'
  WHEN 'flowcv' THEN 'qts-standard'
  ELSE 'qts-standard'
END;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "pdf_template" SET DEFAULT 'qts-standard';--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_pdf_template_check" CHECK ("profiles"."pdf_template" in ('qts-standard', 'classic', 'harvard', 'executive', 'minimal', 'swiss', 'corporate', 'technical', 'timeline', 'banded', 'elegant', 'bold', 'creative', 'compact', 'academic', 'nordic', 'slate', 'ledger', 'startup', 'professional', 'centered', 'high-contrast', 'modern-serif', 'graphite'));
