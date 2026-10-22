CREATE TABLE "sub_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_category_id_categories_id_fk";
--> statement-breakpoint
DROP INDEX "categories_name_normalized_unique";
--> statement-breakpoint
DO $$
DECLARE
	general_category_id uuid;
BEGIN
	INSERT INTO "categories" ("name")
	VALUES ('General')
	RETURNING "id" INTO general_category_id;

	INSERT INTO "sub_categories" ("id", "category_id", "name", "created_at", "updated_at")
	SELECT "id", general_category_id, "name", "created_at", "updated_at"
	FROM "categories"
	WHERE "id" <> general_category_id;

	DELETE FROM "categories"
	WHERE "id" <> general_category_id;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_normalized_unique" ON "categories" USING btree (lower(btrim("name")));
--> statement-breakpoint
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sub_categories_category_name_normalized_unique" ON "sub_categories" USING btree ("category_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "sub_categories_category_id_index" ON "sub_categories" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_category_id_sub_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sub_categories"("id") ON DELETE set null ON UPDATE no action;