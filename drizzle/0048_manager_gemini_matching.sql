ALTER TABLE "users" ADD COLUMN "use_gemini_matching" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Carry the old global Get JD mode over: if it was Gemini, every Manager keeps Gemini matching.
UPDATE "users" SET "use_gemini_matching" = true WHERE "role" = 'manager' AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'get_jd_matching_mode' AND "value" = '"gemini"'::jsonb);
