-- Accounts now belong to a category directly. Each account moves to its subcategory's
-- parent category before the subcategories are dropped.
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_category_id_sub_categories_id_fk";--> statement-breakpoint
UPDATE "profiles"
SET "category_id" = "sub_categories"."category_id"
FROM "sub_categories"
WHERE "sub_categories"."id" = "profiles"."category_id";--> statement-breakpoint
DROP TABLE "sub_categories";--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
