CREATE TABLE "callers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "caller_id" uuid;--> statement-breakpoint
ALTER TABLE "callers" ADD CONSTRAINT "callers_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "callers_admin_name_active_unique" ON "callers" USING btree ("admin_id",lower(btrim("name"))) WHERE "callers"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."callers"("id") ON DELETE set null ON UPDATE no action;