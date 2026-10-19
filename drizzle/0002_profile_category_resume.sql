CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "resume_pdf_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_normalized_unique" ON "categories" USING btree (lower(btrim("name")));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_category_id_index" ON "profiles" USING btree ("category_id");