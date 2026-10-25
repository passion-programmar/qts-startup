-- Default categories, with Global as the one every account falls back to.
ALTER TABLE "categories" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_one_default_unique" ON "categories" USING btree ("is_default") WHERE "categories"."is_default";--> statement-breakpoint
INSERT INTO "categories" ("name")
VALUES ('AI / ML'), ('DevOps / Cloud'), ('Full Stack'), ('Backend'), ('Data Scientist'), ('Automation'), ('Global')
ON CONFLICT (lower(btrim("name"))) DO NOTHING;--> statement-breakpoint
UPDATE "categories" SET "is_default" = true, "updated_at" = now()
WHERE lower(btrim("name")) = 'global';--> statement-breakpoint

-- Every account has a category: uncategorized accounts move to Global, and a category in use
-- can no longer be deleted out from under its accounts.
UPDATE "profiles"
SET "category_id" = (SELECT "id" FROM "categories" WHERE "is_default")
WHERE "category_id" IS NULL;--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Managers write their own document prompts; deleting one archives it.
ALTER TABLE "prompts" ADD COLUMN "owner_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_owner_manager_id_users_id_fk" FOREIGN KEY ("owner_manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompts_owner_manager_id_index" ON "prompts" USING btree ("owner_manager_id");--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_manager_owned_document_check" CHECK ("prompts"."owner_manager_id" is null or ("prompts"."purpose" = 'document_generation' and not "prompts"."is_default"));
