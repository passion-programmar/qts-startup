CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'manager', 'account');--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"candidate_email" text,
	"phone" text,
	"headline" text,
	"linkedin_url" text,
	"country_code" varchar(2),
	"city" text,
	"province" text,
	"address_line_1" text,
	"address_line_2" text,
	"postal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" NOT NULL,
	"parent_user_id" uuid,
	"display_name" text NOT NULL,
	"login_name" text,
	"password_hash" text,
	"blocked_at" timestamp with time zone,
	"blocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_parent_matches_role_check" CHECK (("users"."role" = 'super_admin' and "users"."parent_user_id" is null) or ("users"."role" <> 'super_admin' and "users"."parent_user_id" is not null)),
	CONSTRAINT "users_login_credentials_match_role_check" CHECK (("users"."role" = 'account' and "users"."login_name" is null and "users"."password_hash" is null) or ("users"."role" <> 'account' and "users"."login_name" is not null and "users"."password_hash" is not null)),
	CONSTRAINT "users_block_audit_fields_check" CHECK (("users"."blocked_at" is null and "users"."blocked_by" is null) or ("users"."blocked_at" is not null and "users"."blocked_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_blocked_by_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_candidate_email_normalized_unique" ON "profiles" USING btree (lower(btrim("candidate_email"))) WHERE "profiles"."candidate_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_name_unique" ON "users" USING btree (lower(btrim("login_name"))) WHERE "users"."login_name" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_super_admin_unique" ON "users" USING btree ("role") WHERE "users"."role" = 'super_admin';--> statement-breakpoint
CREATE FUNCTION "public"."enforce_user_hierarchy"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_role "public"."user_role";
  expected_parent_role "public"."user_role";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."role" IS DISTINCT FROM OLD."role" THEN
    RAISE EXCEPTION 'User roles cannot be changed after creation';
  END IF;

  IF NEW."role" = 'super_admin' THEN
    IF NEW."parent_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Super Admin must not have a parent';
    END IF;
    RETURN NEW;
  END IF;

  expected_parent_role := CASE NEW."role"
    WHEN 'admin' THEN 'super_admin'::"public"."user_role"
    WHEN 'manager' THEN 'admin'::"public"."user_role"
    WHEN 'account' THEN 'manager'::"public"."user_role"
  END;

  SELECT "role" INTO parent_role
  FROM "public"."users"
  WHERE "id" = NEW."parent_user_id";

  IF parent_role IS DISTINCT FROM expected_parent_role THEN
    RAISE EXCEPTION 'Invalid parent role for user role %', NEW."role";
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "users_hierarchy_guard"
BEFORE INSERT OR UPDATE OF "role", "parent_user_id" ON "public"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_user_hierarchy"();--> statement-breakpoint
CREATE FUNCTION "public"."enforce_profile_account_role"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."users"
    WHERE "id" = NEW."user_id"
      AND "role" = 'account'
  ) THEN
    RAISE EXCEPTION 'Profiles can only be created for candidate Account users';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "profiles_account_role_guard"
BEFORE INSERT OR UPDATE OF "user_id" ON "public"."profiles"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_profile_account_role"();