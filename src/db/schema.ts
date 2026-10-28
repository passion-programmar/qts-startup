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

// Apply status of one account's jobs row. "applied" exactly when the account has
// a bid for the job (src/server/jobs/job-bids.ts keeps the two in step).
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
  "delivered",
  "failed",
]);

export const generationQueueStatus = pgEnum("generation_queue_status", [
  "not_queued",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    // The one category ("Global") new accounts start in and deleted categories' accounts move to.
    isDefault: boolean("is_default").default(false).notNull(),
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
    uniqueIndex("categories_one_default_unique")
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
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
    // Super Admin assigns Gemini candidate matching per Manager; others use general Get JD.
    useGeminiMatching: boolean("use_gemini_matching").default(false).notNull(),
    // Super Admin turns Apply on per Manager and picks the AI that answers its open questions.
    canUseApply: boolean("can_use_apply").default(false).notNull(),
    applyAiMode: text("apply_ai_mode").default("chatgpt").notNull(),
    // Apply clicks Submit itself when on (Super Admin, per Manager); a bid still waits for the Manager's Yes.
    autoSubmit: boolean("auto_submit").default(false).notNull(),
    // When Apply stops for the Manager (Super Admin, per Manager): "every_step" (the default) or
    // "before_submit", where it goes through the steps itself and stops once before Submit. Problems
    // still stop on their step either way.
    applyReviewMode: text("apply_review_mode").default("every_step").notNull(),
    // The Manager's one password for the candidates' accounts on job sites, encrypted
    // (src/server/apply/site-account-password.ts); Apply fills it on sign-in and registration pages.
    siteAccountPassword: text("site_account_password"),
    // The Romania-time day the "Clear applied jobs?" question was last asked: once a day across all Chromes.
    appliedCleanupAskedOn: date("applied_cleanup_asked_on", { mode: "string" }),
    // "Stop all" on the Jobs page bumps a counter; every Chrome stops that mode when it sees a new value.
    generationStopVersion: integer("generation_stop_version").default(0).notNull(),
    applyStopVersion: integer("apply_stop_version").default(0).notNull(),
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
    check("users_apply_review_mode_check", sql`${table.applyReviewMode} in ('every_step', 'before_submit')`),
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
    check("users_apply_ai_mode_check", sql`${table.applyAiMode} in ('chatgpt', 'gemini')`),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    // Every account has a category; new accounts start in the default one.
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    resumePdfId: uuid("resume_pdf_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthday: date("birthday", { mode: "string" }),
    pdfTemplate: text("pdf_template").default("qts-standard").notNull(),
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
    // Facts application forms ask for. Apply fills what fits from here; ChatGPT answers the rest.
    workAuthorization: text("work_authorization"),
    needsSponsorship: boolean("needs_sponsorship"),
    noticePeriod: text("notice_period").default("immediately").notNull(),
    salaryExpectationAmount: integer("salary_expectation_amount"),
    salaryExpectationCurrency: text("salary_expectation_currency"),
    salaryExpectationPeriod: text("salary_expectation_period"),
    yearsOfExperience: integer("years_of_experience"),
    willingToRelocate: boolean("willing_to_relocate"),
    githubUrl: text("github_url"),
    portfolioUrl: text("portfolio_url"),
    eeoPreference: text("eeo_preference").default("prefer_not_to_say").notNull(),
    nationality: text("nationality"),
    // Countries or regions the candidate may work in without sponsorship ("EU, UK").
    workCountries: text("work_countries"),
    workPermitExpiry: date("work_permit_expiry", { mode: "string" }),
    // Languages with levels ("English C1, Polish C2").
    languages: text("languages"),
    contractType: text("contract_type"),
    workHours: text("work_hours"),
    workMode: text("work_mode"),
    // Anything else ChatGPT should know when answering application questions.
    applicationNotes: text("application_notes"),
    // The candidate's own answers to diversity (EEO) questions; keys from src/lib/diversity-options.ts.
    gender: text("gender"),
    ethnicity: text("ethnicity"),
    veteranStatus: text("veteran_status"),
    disabilityStatus: text("disability_status"),
    sexualOrientation: text("sexual_orientation"),
    pronouns: text("pronouns"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("profiles_category_id_index").on(table.categoryId),
    check(
      "profiles_salary_expectation_check",
      sql`(${table.salaryExpectationAmount} is null or ${table.salaryExpectationAmount} > 0) and (${table.salaryExpectationPeriod} is null or ${table.salaryExpectationPeriod} in ('year', 'month', 'day', 'hour'))`,
    ),
    check("profiles_notice_period_check", sql`${table.noticePeriod} in ('immediately', '1_week')`),
    check(
      "profiles_years_of_experience_check",
      sql`${table.yearsOfExperience} is null or ${table.yearsOfExperience} between 0 and 70`,
    ),
    check(
      "profiles_eeo_preference_check",
      sql`${table.eeoPreference} in ('prefer_not_to_say', 'answer_from_profile')`,
    ),
    check(
      "profiles_work_preferences_check",
      sql`(${table.contractType} is null or ${table.contractType} in ('employment', 'b2b', 'either')) and (${table.workHours} is null or ${table.workHours} in ('full_time', 'part_time', 'either')) and (${table.workMode} is null or ${table.workMode} in ('remote', 'hybrid', 'onsite', 'any'))`,
    ),
    uniqueIndex("profiles_candidate_email_normalized_unique")
      .on(sql`lower(btrim(${table.candidateEmail}))`)
      .where(sql`${table.candidateEmail} is not null`),
    check(
      "profiles_pdf_template_check",
      sql`${table.pdfTemplate} in ('qts-standard', 'classic', 'harvard', 'executive', 'minimal', 'swiss', 'corporate', 'technical', 'timeline', 'banded', 'elegant', 'bold', 'creative', 'compact', 'academic', 'nordic', 'slate', 'ledger', 'startup', 'professional', 'centered', 'high-contrast', 'modern-serif', 'graphite')`,
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
    // Set on a Manager's own ChatGPT document prompts; null for Super Admin's library prompts.
    ownerManagerId: uuid("owner_manager_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    // Deleting a prompt archives every version, so jobs and bids keep showing what they used.
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
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
      sql`(${table.provider} = 'openai' and ${table.purpose} in ('document_generation', 'application_answer')) or (${table.provider} = 'gemini' and ${table.purpose} in ('job_description_evaluation', 'application_answer'))`,
    ),
    // Managers own only document prompts, and only a library prompt can be the default.
    check(
      "prompts_manager_owned_document_check",
      sql`${table.ownerManagerId} is null or (${table.purpose} = 'document_generation' and not ${table.isDefault})`,
    ),
    index("prompts_owner_manager_id_index").on(table.ownerManagerId),
  ],
);

// Each Chrome running the extension, per Manager. browser_key is the random ID the extension
// keeps in its own storage; the name is automatic until the Manager renames it.
export const extensionBrowsers = pgTable(
  "extension_browsers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    browserKey: text("browser_key").notNull(),
    name: text("name").notNull(),
    extensionVersion: text("extension_version"),
    getJdOn: boolean("get_jd_on").default(false).notNull(),
    workMode: text("work_mode").default("off").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
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
    uniqueIndex("extension_browsers_manager_key_unique").on(table.managerId, table.browserKey),
    check("extension_browsers_work_mode_check", sql`${table.workMode} in ('off', 'generation', 'apply')`),
  ],
);

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
    // Chosen when the run starts, so every download of this run uses the same template.
    pdfTemplate: text("pdf_template"),
    // The prompt version this run used: one of the Manager's own, or Super Admin's default.
    promptId: uuid("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
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
    // Plain page innerText, kept only while description is empty.
    pageText: text("page_text"),
    // Shared-job identity (docs/get-jd-redesign.md). Nullable until the backfill
    // script fills existing rows; the constrain step then makes them required.
    relationId: uuid("relation_id"),
    jobKey: text("job_key"),
    titleCompanyKey: text("title_company_key"),
    location: text("location"),
    employmentType: text("employment_type"),
    workplaceType: text("workplace_type"),
    salary: text("salary"),
    jobReason: text("job_reason"),
    autoSavedByGetJd: boolean("auto_saved_by_get_jd").default(false).notNull(),
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
    // Where the generated PDFs are saved on Google Drive, when they are uploaded.
    googleDrivePath: text("google_drive_path"),
    // The prompt version and template of the delivered Generation, shown on Jobs and Bids.
    promptId: uuid("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
    pdfTemplate: text("pdf_template"),
    generationStatus: generationQueueStatus("generation_status")
      .default("not_queued")
      .notNull(),
    generationAttemptCount: integer("generation_attempt_count").default(0).notNull(),
    generationError: text("generation_error"),
    generationLeaseExpiresAt: timestamp("generation_lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    // The last Apply runs on this job, newest first (at most 10): when, how each ended, and every
    // answer with its source (profile, reusable answer, ChatGPT...), for the Jobs page.
    applyAnswers: jsonb("apply_answers"),
    // The delivered résumé and cover letter as plain text (the PDFs' words), saved by Generation:
    // Apply's ChatGPT answers use them, and cover-letter text boxes get the letter.
    resumeText: text("resume_text"),
    coverLetterText: text("cover_letter_text"),
    // The main site the job was found on (the page it was opened from, a source tag in its link, or
    // its own job site), saved by Get JD; copied into the bid.
    sourceSiteUrl: text("source_site_url"),
    // The Chrome processing this row's Generation; each Chrome processes one row at a time.
    generationBrowserId: uuid("generation_browser_id").references(
      (): AnyPgColumn => extensionBrowsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "jobs_generation_attempt_count_nonnegative",
      sql`${table.generationAttemptCount} >= 0`,
    ),
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
    index("jobs_relation_id_index").on(table.relationId),
    // An account never gets the same job twice, by URL or by title + company.
    // Null keys (rows not backfilled yet) never conflict.
    uniqueIndex("jobs_job_key_candidate_unique").on(table.jobKey, table.candidateId),
    uniqueIndex("jobs_title_company_key_candidate_unique").on(table.titleCompanyKey, table.candidateId),
    uniqueIndex("jobs_one_generation_per_browser_unique")
      .on(table.generationBrowserId)
      .where(sql`${table.generationStatus} = 'processing' and ${table.generationBrowserId} is not null`),
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

// One application the Manager confirmed (Yes after Submit). Independent of the jobs row: every
// value is a copy taken when it was made, so cleaning up job rows or renaming prompts never changes it.
export const bids = pgTable(
  "bids",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "restrict" }),
    jobUrl: text("job_url").notNull(),
    jobTitle: text("job_title").notNull(),
    company: text("company").notNull(),
    // Same-job key with job_url, so "Applied" is still found if the jobs row was deleted.
    titleCompanyKey: text("title_company_key"),
    location: text("location"),
    // Employment type and work arrangement, e.g. "Full-time · Remote".
    workType: text("work_type"),
    salary: text("salary"),
    // The folder holding the résumé and cover letter, under Downloads, and the Chrome that saved them.
    resumeFolder: text("resume_folder").notNull(),
    resumeSavedOn: text("resume_saved_on"),
    // The main site the job was found on, copied from the jobs row (LinkedIn, a job board, its own site).
    sourceSiteUrl: text("source_site_url"),
    googleDrivePath: text("google_drive_path"),
    templateName: text("template_name"),
    promptName: text("prompt_name"),
    // What was submitted: [{ question, answer, source }], the Manager's edits included.
    answers: jsonb("answers"),
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
    // One bid per candidate and job address.
    uniqueIndex("bids_candidate_job_url_unique").on(
      table.candidateId,
      sql`regexp_replace(split_part(btrim(${table.jobUrl}), '#', 1), '/+$', '')`,
    ),
    index("bids_manager_title_company_key_index").on(table.managerId, table.titleCompanyKey),
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

// One application of one jobs row. A Chrome claims it (lease renewed by heartbeats) and fills it
// ("claimed"), the Manager reviews it ("waiting_review"), clicks Submit ("waiting_confirmation"), and
// answers Yes ("confirmed", which makes the bid) or No ("failed"). Once submitted the job is never
// handed out again unless the Manager clicks "Apply again" ("cleared"). Claims go through
// claim_apply_attempt (migrations 0062, 0070). "submitting" and "not_confirmed" are from before review.
export const applyAttempts = pgTable(
  "apply_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "restrict" }),
    browserId: uuid("browser_id").references(() => extensionBrowsers.id, { onDelete: "set null" }),
    status: text("status").default("claimed").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    submitGrantedAt: timestamp("submit_granted_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    resultReason: text("result_reason"),
    confirmationSource: text("confirmation_source"),
    screenshotBrowserName: text("screenshot_browser_name"),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "apply_attempts_status_check",
      sql`${table.status} in ('claimed', 'waiting_review', 'waiting_confirmation', 'submitting', 'confirmed', 'not_confirmed', 'failed', 'released', 'skipped', 'cleared')`,
    ),
    // Only an attempt recorded as submitted can wait for the Manager's answer or end confirmed.
    check(
      "apply_attempts_submit_audit_check",
      sql`${table.status} not in ('waiting_confirmation', 'submitting', 'confirmed', 'not_confirmed') or ${table.submitGrantedAt} is not null`,
    ),
    // One live attempt per job, across every Chrome. A candidate may have several job pages open at
    // once (the assistant, 1.41.0), so there is no limit per candidate (0078).
    uniqueIndex("apply_attempts_one_live_per_job_unique")
      .on(table.jobId)
      .where(sql`${table.status} in ('claimed', 'waiting_review', 'waiting_confirmation', 'submitting')`),
    index("apply_attempts_manager_status_index").on(table.managerId, table.status),
  ],
);

// Answers to application questions, per candidate, reused without AI the next time the question appears.
export const candidateSavedAnswers = pgTable(
  "candidate_saved_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    answer: text("answer").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("candidate_saved_answers_question_unique").on(table.candidateId, table.questionKey),
    check("candidate_saved_answers_source_check", sql`${table.source} in ('manager', 'ai')`),
  ],
);

// Super Admin's reusable answers for application questions every candidate may meet ("How did you
// hear about us?"). Apply uses one when its question matches and the answer fits the field; when it
// does not fit, ChatGPT gets it as a hint. Profile facts come first and are never overridden.
export const reusableAnswers = pgTable(
  "reusable_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    answer: text("answer").notNull(),
    // Guidance for ChatGPT when the answer has to be adapted to a field ("pick the closest choice").
    note: text("note"),
    // Added by Apply's learning (a choice question every candidate answered the same way), not by hand.
    autoAdded: boolean("auto_added").default(false).notNull(),
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
  (table) => [uniqueIndex("reusable_answers_question_key_unique").on(table.questionKey)],
);

// What Apply learned about one application question, kept small: one row per question (not per
// application). It holds how often the question came up, a few choice lists forms offered, the
// top answers with the candidates who gave them, and remembered choices (which option a value
// that did not fit became on a given choice list). Updated when the Manager answers Yes; feeds the
// suggestions in Settings and safe automatic reusable answers. Personal facts and long free-text
// answers are never stored here; rows unseen for 90 days are removed.
export const applyQuestionMemory = pgTable(
  "apply_question_memory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    // "choice" (Yes/No, menus, radios, tick lists) or "text".
    kind: text("kind").default("choice").notNull(),
    timesSeen: integer("times_seen").default(0).notNull(),
    // Up to 5 choice lists forms offered: [["Yes", "No"], ...].
    options: jsonb("options").default(sql`'[]'::jsonb`).notNull(),
    // Up to 5 answers, most used first: [{ answer, count, candidates: [candidateId, ...] }].
    answers: jsonb("answers").default(sql`'[]'::jsonb`).notNull(),
    // Up to 10 remembered choices: [{ optionsKey, intended, choice, uses }].
    choices: jsonb("choices").default(sql`'[]'::jsonb`).notNull(),
    dismissed: boolean("dismissed").default(false).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("apply_question_memory_question_key_unique").on(table.questionKey),
    index("apply_question_memory_last_seen_index").on(table.lastSeenAt),
    check("apply_question_memory_kind_check", sql`${table.kind} in ('choice', 'text')`),
  ],
);

// A Manager's own library of prompts kept for special cases; Generation and Apply never use them.
// Every save adds a version: one prompt's versions share prompt_key, the highest is current.
export const usefulPrompts = pgTable(
  "useful_prompts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promptKey: uuid("prompt_key").notNull(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("useful_prompts_key_version_unique").on(table.promptKey, table.version),
    index("useful_prompts_manager_index").on(table.managerId),
    check("useful_prompts_version_positive", sql`${table.version} >= 1`),
  ],
);

// Get JD's "being checked" mark: while one Chrome evaluates a job link, others wait for its
// verdict instead of calling Gemini again; the verdict is replayed until expires_at.
export const getJdPageChecks = pgTable(
  "get_jd_page_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageKey: text("page_key").notNull(),
    status: text("status").default("checking").notNull(),
    result: jsonb("result"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("get_jd_page_checks_manager_page_unique").on(table.managerId, table.pageKey),
    check("get_jd_page_checks_status_check", sql`${table.status} in ('checking', 'done')`),
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
    // Remote, hybrid or onsite; shown next to the location on generated resumes.
    workMode: text("work_mode"),
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
      "experiences_work_mode_check",
      sql`${table.workMode} is null or ${table.workMode} in ('remote', 'hybrid', 'onsite')`,
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

export const geminiApiCallLogs = pgTable(
  "gemini_api_call_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyHash: text("key_hash").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    httpStatus: integer("http_status"),
    responseBody: text("response_body"),
    responseTruncated: boolean("response_truncated").default(false).notNull(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    // Input-token counts for a GenerateContent request: QTS's local estimate always,
    // and Google's CountTokens result only in Gemini Count mode, so the two can be compared.
    localInputTokens: integer("local_input_tokens"),
    geminiInputTokens: integer("gemini_input_tokens"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check(
      "gemini_api_call_logs_operation_check",
      sql`${table.operation} in ('generate_content', 'count_tokens')`,
    ),
    check(
      "gemini_api_call_logs_status_check",
      sql`${table.status} in ('pending', 'http_success', 'http_error', 'network_error')`,
    ),
    index("gemini_api_call_logs_key_started_at_index").on(
      table.keyHash,
      table.startedAt,
    ),
    // Supports the automatic removal of records older than the last three Pacific days.
    index("gemini_api_call_logs_started_at_index").on(table.startedAt),
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
