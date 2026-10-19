CREATE TABLE "educations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_user_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"degree" text,
	"field_of_study" text,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "educations_start_date_month_precision_check" CHECK ("educations"."start_date" is null or extract(day from "educations"."start_date") = 1),
	CONSTRAINT "educations_end_date_month_precision_check" CHECK ("educations"."end_date" is null or extract(day from "educations"."end_date") = 1),
	CONSTRAINT "educations_end_after_start_check" CHECK ("educations"."start_date" is null or "educations"."end_date" is null or "educations"."end_date" >= "educations"."start_date"),
	CONSTRAINT "educations_current_without_end_date_check" CHECK (not "educations"."is_current" or "educations"."end_date" is null),
	CONSTRAINT "educations_sort_order_nonnegative_check" CHECK ("educations"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_user_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"job_title" text NOT NULL,
	"location" text,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_start_date_month_precision_check" CHECK ("experiences"."start_date" is null or extract(day from "experiences"."start_date") = 1),
	CONSTRAINT "experiences_end_date_month_precision_check" CHECK ("experiences"."end_date" is null or extract(day from "experiences"."end_date") = 1),
	CONSTRAINT "experiences_end_after_start_check" CHECK ("experiences"."start_date" is null or "experiences"."end_date" is null or "experiences"."end_date" >= "experiences"."start_date"),
	CONSTRAINT "experiences_current_without_end_date_check" CHECK (not "experiences"."is_current" or "experiences"."end_date" is null),
	CONSTRAINT "experiences_sort_order_nonnegative_check" CHECK ("experiences"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "educations" ADD CONSTRAINT "educations_profile_user_id_profiles_user_id_fk" FOREIGN KEY ("profile_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_profile_user_id_profiles_user_id_fk" FOREIGN KEY ("profile_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "educations_profile_sort_order_index" ON "educations" USING btree ("profile_user_id","sort_order");--> statement-breakpoint
CREATE INDEX "experiences_profile_sort_order_index" ON "experiences" USING btree ("profile_user_id","sort_order");