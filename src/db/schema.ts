import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", [
  "super_admin",
  "admin",
  "manager",
  "account",
]);

export const jobStatus = pgEnum("job_status", [
  "todo",
  "pending",
  "applied",
  "failed",
]);

export const promptProvider = pgEnum("prompt_provider", ["openai", "gemini"]);

export const promptPurpose = pgEnum("prompt_purpose", [
  "document_generation",
  "job_description_evaluation",
  "application_answer",
]);

export const generationRunStatus = pgEnum("generation_run_status", [
  "pending",
  "completed",
  "failed",
]);

export const generationQueueStatus = pgEnum("generation_queue_status", [
  "not_queued",
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("categories_name_normalized_unique").on(
      sql`lower(btrim(${table.name}))`,
    ),
  ],
);

export const subCategories = pgTable(
  "sub_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sub_categories_category_name_normalized_unique").on(
      table.categoryId,
      sql`lower(btrim(${table.name}))`,
    ),
    index("sub_categories_category_id_index").on(table.categoryId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    role: userRole("role").notNull(),
    parentUserId: uuid("parent_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    displayName: text("display_name"),
    loginName: text("login_name"),
    passwordHash: text("password_hash"),
    canManageTextHighlights: boolean("can_manage_text_highlights")
      .default(false)
      .notNull(),
    canManagePageExclusions: boolean("can_manage_page_exclusions")
      .default(false)
      .notNull(),
    canManageJobDetectionUrlRules: boolean("can_manage_job_detection_url_rules")
      .default(false)
      .notNull(),
    authVersion: integer("auth_version").default(0).notNull(),
    blockedAt: timestamp("blocked_at", { withTimezone: true, mode: "date" }),
    blockedBy: uuid("blocked_by").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_login_name_unique")
      .on(sql`lower(btrim(${table.loginName}))`)
      .where(sql`${table.loginName} is not null`),
    uniqueIndex("users_single_super_admin_unique")
      .on(table.role)
      .where(sql`${table.role} = 'super_admin'`),
    check(
      "users_parent_matches_role_check",
      sql`(${table.role} = 'super_admin' and ${table.parentUserId} is null) or (${table.role} <> 'super_admin' and ${table.parentUserId} is not null)`,
    ),
    check(
      "users_login_credentials_match_role_check",
      sql`(${table.role} = 'account' and ${table.loginName} is null and ${table.passwordHash} is null) or (${table.role} <> 'account' and ${table.loginName} is not null and ${table.passwordHash} is not null)`,
    ),
    check(
      "users_display_name_matches_role_check",
      sql`(${table.role} = 'account' and ${table.displayName} is null) or (${table.role} <> 'account' and ${table.displayName} is not null)`,
    ),
    check(
      "users_block_audit_fields_check",
      sql`(${table.blockedAt} is null and ${table.blockedBy} is null) or (${table.blockedAt} is not null and ${table.blockedBy} is not null)`,
    ),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    subCategoryId: uuid("category_id").references(() => subCategories.id, {
      onDelete: "set null",
    }),
    resumePdfId: uuid("resume_pdf_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthday: date("birthday", { mode: "string" }),
    pdfTemplate: text("pdf_template").default("heritage").notNull(),
    candidateEmail: text("candidate_email"),
    phone: text("phone"),
    headline: text("headline"),
    linkedinUrl: text("linkedin_url"),
    country: text("country"),
    city: text("city"),
    province: text("province"),
    addressLine1: text("address_line_1"),
    postalCode: text("postal_code"),
    jdMatching: text("jd_matching"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("profiles_category_id_index").on(table.subCategoryId),
    uniqueIndex("profiles_candidate_email_normalized_unique")
      .on(sql`lower(btrim(${table.candidateEmail}))`)
      .where(sql`${table.candidateEmail} is not null`),
    check(
      "profiles_pdf_template_check",
      sql`${table.pdfTemplate} in ('heritage', 'laurel', 'vellum', 'pewter', 'regent', 'onyx', 'palette', 'indigo', 'amber-crest', 'garnet', 'reef', 'verdant', 'ember', 'terminal', 'meridian', 'flowcv')`,
    ),
  ],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "restrict",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const textHighlightRules = pgTable(
  "text_highlight_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    text: text("text").notNull(),
    textColor: text("text_color").notNull(),
    backgroundColor: text("background_color").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("text_highlight_rules_text_normalized_unique").on(
      sql`lower(btrim(${table.text}))`,
    ),
  ],
);

export const extensionPageExclusions = pgTable(
  "extension_page_exclusions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    urlRule: text("url_rule").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("extension_page_exclusions_manager_url_unique").on(
      table.managerId,
      table.urlRule,
    ),
    index("extension_page_exclusions_manager_id_index").on(table.managerId),
  ],
);

export const extensionJobDetectionUrlRules = pgTable(
  "extension_job_detection_url_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    urlRule: text("url_rule").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("extension_job_detection_url_rules_manager_url_unique").on(
      table.managerId,
      table.urlRule,
    ),
    index("extension_job_detection_url_rules_manager_id_index").on(table.managerId),
  ],
);

export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promptGroupId: uuid("prompt_group_id").defaultRandom().notNull(),
    provider: promptProvider("provider").notNull(),
    purpose: promptPurpose("purpose").notNull(),
    name: text("name").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("prompts_group_version_unique").on(
      table.promptGroupId,
      table.version,
    ),
    uniqueIndex("prompts_one_active_version_per_group_unique")
      .on(table.promptGroupId)
      .where(sql`${table.isActive}`),
    uniqueIndex("prompts_one_default_per_provider_purpose_unique")
      .on(table.provider, table.purpose)
      .where(sql`${table.isDefault}`),
    check("prompts_version_positive_check", sql`${table.version} > 0`),
    check(
      "prompts_provider_matches_purpose_check",
      sql`(${table.provider} = 'openai' and ${table.purpose} = 'document_generation') or (${table.provider} = 'gemini' and ${table.purpose} in ('job_description_evaluation', 'application_answer'))`,
    ),
  ],
);

export const managerPromptOverrides = pgTable("manager_prompt_overrides", {
  managerId: uuid("manager_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  promptTemplate: text("prompt_template").notNull(),
  basedOnPromptId: uuid("based_on_prompt_id").references(() => prompts.id, {
    onDelete: "restrict",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const managerPromptAssignments = pgTable("manager_prompt_assignments", {
  managerId: uuid("manager_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  promptId: uuid("prompt_id")
    .notNull()
    .references(() => prompts.id, { onDelete: "restrict" }),
  assignedByUserId: uuid("assigned_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const generationRuns = pgTable(
  "generation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    jobUrl: text("job_url").notNull(),
    jobTitle: text("job_title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    jobDescription: text("job_description").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    composedPrompt: text("composed_prompt").notNull(),
    responseText: text("response_text"),
    responseJson: jsonb("response_json"),
    status: generationRunStatus("status").default("pending").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("generation_runs_manager_created_at_index").on(
      table.managerId,
      table.createdAt,
    ),
    index("generation_runs_manager_status_index").on(
      table.managerId,
      table.status,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobUrl: text("job_url").notNull(),
    jobTitle: text("job_title").notNull(),
    company: text("company").notNull(),
    description: text("description"),
    location: text("location"),
    employmentType: text("employment_type"),
    workplaceType: text("workplace_type"),
    salary: text("salary"),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "restrict" }),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    status: jobStatus("status").default("todo").notNull(),
    failureReason: text("failure_reason"),
    resumeLocalPath: text("resume_local_path"),
    generationStatus: generationQueueStatus("generation_status")
      .default("not_queued")
      .notNull(),
    generationError: text("generation_error"),
    generationLeaseExpiresAt: timestamp("generation_lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("jobs_manager_candidate_normalized_url_unique").on(
      table.managerId,
      table.candidateId,
      sql`regexp_replace(split_part(btrim(${table.jobUrl}), '#', 1), '/+$', '')`,
    ),
    uniqueIndex("jobs_manager_candidate_title_company_unique").on(
      table.managerId,
      table.candidateId,
      sql`lower(btrim(${table.jobTitle}))`,
      sql`lower(btrim(${table.company}))`,
    ),
    index("jobs_manager_date_index").on(table.managerId, table.date),
    index("jobs_candidate_date_status_index").on(
      table.candidateId,
      table.date,
      table.status,
    ),
    index("jobs_job_title_trgm_index").using(
      "gin",
      table.jobTitle.op("gin_trgm_ops"),
    ),
    index("jobs_job_url_trgm_index").using(
      "gin",
      table.jobUrl.op("gin_trgm_ops"),
    ),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceJobId: uuid("source_job_id").notNull(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "restrict" }),
    jobUrl: text("job_url").notNull(),
    jobTitle: text("job_title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    employmentType: text("employment_type"),
    workplaceType: text("workplace_type"),
    salary: text("salary"),
    resumeLocalPath: text("resume_local_path").notNull(),
    googleDrivePath: text("googledriver_path"),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bids_source_job_id_unique").on(table.sourceJobId),
    index("bids_manager_applied_at_index").on(table.managerId, table.appliedAt),
    index("bids_candidate_applied_at_index").on(
      table.candidateId,
      table.appliedAt,
    ),
    index("bids_job_title_trgm_index").using(
      "gin",
      table.jobTitle.op("gin_trgm_ops"),
    ),
    index("bids_job_url_trgm_index").using(
      "gin",
      table.jobUrl.op("gin_trgm_ops"),
    ),
  ],
);

export const educations = pgTable(
  "educations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileUserId: uuid("profile_user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    degree: text("degree"),
    fieldOfStudy: text("field_of_study"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    isCurrent: boolean("is_current").default(false).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("educations_profile_sort_order_index").on(
      table.profileUserId,
      table.sortOrder,
    ),
    check(
      "educations_start_date_month_precision_check",
      sql`${table.startDate} is null or extract(day from ${table.startDate}) = 1`,
    ),
    check(
      "educations_end_date_month_precision_check",
      sql`${table.endDate} is null or extract(day from ${table.endDate}) = 1`,
    ),
    check(
      "educations_end_after_start_check",
      sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "educations_current_without_end_date_check",
      sql`not ${table.isCurrent} or ${table.endDate} is null`,
    ),
    check(
      "educations_sort_order_nonnegative_check",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileUserId: uuid("profile_user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    jobTitle: text("job_title").notNull(),
    location: text("location"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    isCurrent: boolean("is_current").default(false).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("experiences_profile_sort_order_index").on(
      table.profileUserId,
      table.sortOrder,
    ),
    check(
      "experiences_start_date_month_precision_check",
      sql`${table.startDate} is null or extract(day from ${table.startDate}) = 1`,
    ),
    check(
      "experiences_end_date_month_precision_check",
      sql`${table.endDate} is null or extract(day from ${table.endDate}) = 1`,
    ),
    check(
      "experiences_end_after_start_check",
      sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "experiences_current_without_end_date_check",
      sql`not ${table.isCurrent} or ${table.endDate} is null`,
    ),
    check(
      "experiences_sort_order_nonnegative_check",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const loginHistory = pgTable(
  "login_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loggedInAt: timestamp("logged_in_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("login_history_user_logged_in_at_index").on(table.userId, table.loggedInAt)],
);

export const geminiKeyUsageEvents = pgTable(
  "gemini_key_usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyHash: text("key_hash").notNull(),
    operation: text("operation").default("generate_content").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "gemini_key_usage_events_operation_check",
      sql`${table.operation} in ('generate_content', 'count_tokens')`,
    ),
    index("gemini_key_usage_events_key_occurred_at_index").on(
      table.keyHash,
      table.occurredAt,
    ),
  ],
);

export const geminiKeyBusyLeases = pgTable("gemini_key_busy_leases", {
  keyHash: text("key_hash").primaryKey(),
  leaseId: uuid("lease_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
    .notNull(),
});

export const loginRateLimitEvents = pgTable(
  "login_rate_limit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyHash: text("key_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("login_rate_limit_events_occurred_at_index").on(table.occurredAt),
    index("login_rate_limit_events_key_occurred_at_index").on(
      table.keyHash,
      table.occurredAt,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type ManagerPromptOverride = typeof managerPromptOverrides.$inferSelect;
export type NewManagerPromptOverride =
  typeof managerPromptOverrides.$inferInsert;
export type ManagerPromptAssignment =
  typeof managerPromptAssignments.$inferSelect;
export type NewManagerPromptAssignment =
  typeof managerPromptAssignments.$inferInsert;
export type GenerationRun = typeof generationRuns.$inferSelect;
export type NewGenerationRun = typeof generationRuns.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Bid = typeof bids.$inferSelect;
export type NewBid = typeof bids.$inferInsert;
export type Education = typeof educations.$inferSelect;
export type NewEducation = typeof educations.$inferInsert;
export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
export type LoginHistory = typeof loginHistory.$inferSelect;
