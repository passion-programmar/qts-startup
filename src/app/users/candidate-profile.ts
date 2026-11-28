import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { educations, experiences } from "@/db/schema";
import { db } from "@/lib/db";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";
import type { CandidateProfileValues } from "@/app/users/candidate-form";

type CandidateRow = {
  id: string;
  deleted_at: Date | string | null;
  first_name: string | null;
  last_name: string | null;
  birthday: string | null;
  pdf_template: string | null;
  candidate_email: string | null;
  phone: string | null;
  headline: string | null;
  linkedin_url: string | null;
  country: string | null;
  city: string | null;
  province: string | null;
  address_line_1: string | null;
  postal_code: string | null;
  category_id: string | null;
  category_name: string | null;
  manager_category: string | null;
  manager_category_color: string | null;
  linkedin_status: string | null;
  work_authorization: string | null;
  needs_sponsorship: boolean | null;
  notice_period: string | null;
  salary_expectation_amount: number | null;
  salary_expectation_currency: string | null;
  salary_expectation_period: string | null;
  years_of_experience: number | null;
  willing_to_relocate: boolean | null;
  github_url: string | null;
  portfolio_url: string | null;
  eeo_preference: string | null;
  nationality: string | null;
  work_countries: string | null;
  work_permit_expiry: string | null;
  languages: string | null;
  contract_type: string | null;
  work_hours: string | null;
  work_mode: string | null;
  application_notes: string | null;
  gender: string | null;
  ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;
  sexual_orientation: string | null;
  pronouns: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One candidate of this Manager, with everything the edit page shows. Null when the id is not a
 * candidate account the Manager owns. A deleted candidate comes back with deleted: true (read-only).
 * managerId null (the Super Admin, read-only view) accepts any Manager's candidate.
 */
export async function loadManagerCandidateProfile(
  managerId: string | null,
  candidateId: string,
): Promise<{ candidate: CandidateProfileValues; deleted: boolean } | null> {
  if (!uuidPattern.test(candidateId)) return null;
  // The profile and its history load together (one wait, not two). History for an id that is not
  // this Manager's candidate is thrown away below, never returned.
  const [result, educationRows, experienceRows] = await Promise.all([db.execute<CandidateRow>(sql`
    select
      users.id, users.deleted_at,
      profiles.first_name, profiles.last_name, profiles.birthday, profiles.pdf_template,
      profiles.candidate_email, profiles.phone, profiles.headline, profiles.linkedin_url,
      profiles.country, profiles.city, profiles.province, profiles.address_line_1, profiles.postal_code,
      profiles.category_id, categories.name as category_name,
      profiles.manager_category, profiles.manager_category_color, profiles.linkedin_status,
      profiles.work_authorization, profiles.needs_sponsorship, profiles.notice_period,
      profiles.salary_expectation_amount, profiles.salary_expectation_currency, profiles.salary_expectation_period,
      profiles.years_of_experience, profiles.willing_to_relocate, profiles.github_url, profiles.portfolio_url,
      profiles.eeo_preference, profiles.nationality, profiles.work_countries,
      to_char(profiles.work_permit_expiry, 'YYYY-MM-DD') as work_permit_expiry,
      profiles.languages, profiles.contract_type, profiles.work_hours, profiles.work_mode,
      profiles.application_notes, profiles.gender, profiles.ethnicity, profiles.veteran_status,
      profiles.disability_status, profiles.sexual_orientation, profiles.pronouns
    from users
    left join profiles on profiles.user_id = users.id
    left join categories on categories.id = profiles.category_id
    where users.id = ${candidateId}::uuid
      and users.role = 'account'
      and (${managerId}::uuid is null or users.parent_user_id = ${managerId}::uuid)
    limit 1
  `),
    // Newest first, the same order the list page used.
    db.select().from(educations).where(eq(educations.profileUserId, candidateId)).orderBy(
      desc(educations.isCurrent),
      sql`coalesce(${educations.endDate}, ${educations.startDate}) desc nulls last`,
      sql`${educations.startDate} desc nulls last`,
      asc(educations.sortOrder),
    ),
    db.select().from(experiences).where(eq(experiences.profileUserId, candidateId)).orderBy(
      desc(experiences.isCurrent),
      sql`coalesce(${experiences.endDate}, ${experiences.startDate}) desc nulls last`,
      sql`${experiences.startDate} desc nulls last`,
      asc(experiences.sortOrder),
    ),
  ]);
  const row = result.rows[0];
  if (!row) return null;

  return {
    deleted: Boolean(row.deleted_at),
    candidate: {
      userId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      birthday: row.birthday,
      pdfTemplate: row.pdf_template && isPdfTemplate(row.pdf_template) ? row.pdf_template : "qts-standard",
      candidateEmail: row.candidate_email,
      phone: row.phone,
      headline: row.headline,
      linkedinUrl: row.linkedin_url,
      country: row.country,
      city: row.city,
      province: row.province,
      addressLine1: row.address_line_1,
      postalCode: row.postal_code,
      categoryId: row.category_id,
      categoryName: row.category_name,
      managerCategory: row.manager_category || "",
      managerCategoryColor: row.manager_category_color,
      linkedinStatus: row.linkedin_status,
      workAuthorization: row.work_authorization,
      needsSponsorship: row.needs_sponsorship,
      noticePeriod: row.notice_period,
      salaryExpectationAmount: row.salary_expectation_amount,
      salaryExpectationCurrency: row.salary_expectation_currency,
      salaryExpectationPeriod: row.salary_expectation_period,
      yearsOfExperience: row.years_of_experience,
      willingToRelocate: row.willing_to_relocate,
      githubUrl: row.github_url,
      portfolioUrl: row.portfolio_url,
      eeoPreference: row.eeo_preference ?? "prefer_not_to_say",
      nationality: row.nationality,
      workCountries: row.work_countries,
      workPermitExpiry: row.work_permit_expiry,
      languages: row.languages,
      contractType: row.contract_type,
      workHours: row.work_hours,
      workMode: row.work_mode,
      applicationNotes: row.application_notes,
      gender: row.gender,
      ethnicity: row.ethnicity,
      veteranStatus: row.veteran_status,
      disabilityStatus: row.disability_status,
      sexualOrientation: row.sexual_orientation,
      pronouns: row.pronouns,
      education: educationRows.map((entry) => ({
        institution: entry.institution,
        degree: entry.degree,
        fieldOfStudy: entry.fieldOfStudy,
        startDate: entry.startDate?.slice(0, 7) ?? null,
        endDate: entry.endDate?.slice(0, 7) ?? null,
        isCurrent: entry.isCurrent,
        description: entry.description,
      })),
      experience: experienceRows.map((entry) => ({
        companyName: entry.companyName,
        jobTitle: entry.jobTitle,
        location: entry.location,
        workMode: entry.workMode,
        startDate: entry.startDate?.slice(0, 7) ?? null,
        endDate: entry.endDate?.slice(0, 7) ?? null,
        isCurrent: entry.isCurrent,
        description: entry.description,
      })),
    },
  };
}
