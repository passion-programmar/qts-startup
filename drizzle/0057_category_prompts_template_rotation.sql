CREATE TABLE "manager_template_assignments" (
	"manager_id" uuid NOT NULL,
	"template" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "manager_template_assignments_manager_id_template_pk" PRIMARY KEY("manager_id","template"),
	CONSTRAINT "manager_template_assignments_template_check" CHECK ("manager_template_assignments"."template" in ('qts-standard', 'classic', 'harvard', 'executive', 'minimal', 'swiss', 'corporate', 'technical', 'timeline', 'banded', 'elegant', 'bold', 'creative', 'compact', 'academic', 'nordic', 'slate', 'ledger', 'startup', 'professional', 'centered', 'high-contrast', 'modern-serif', 'graphite'))
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "pdf_template" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "manager_template_assignments" ADD CONSTRAINT "manager_template_assignments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompts_category_id_index" ON "prompts" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_category_only_for_documents_check" CHECK ("prompts"."purpose" = 'document_generation' or "prompts"."category_id" is null);