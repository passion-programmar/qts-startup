"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { subCategories, users } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  minimumPasswordLength,
  passwordLengthError,
} from "@/lib/password-policy";
import { requireUser } from "@/lib/session";
import {
  isValidBirthday,
  isValidProfileEmail,
  isValidProfileMonth,
  isValidProfilePhone,
  normalizeLinkedInProfile,
  profileMonthOrdinal,
  sortProfileHistoryNewestFirst,
} from "@/server/users/profile-values";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";

export type UserActionState = {
  error: string | null;
  success: string | null;
};

const emptyState: UserActionState = { error: null, success: null };

export async function createUserAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requireUser();
  const expectedRole =
    actor.role === "super_admin"
      ? "admin"
      : actor.role === "admin"
        ? "manager"
        : "account";
  const loginName = readText(formData, "loginName", 128);
  const password = readSecret(formData, "password");
  const firstName = readText(formData, "firstName", 120);
  const lastName = readText(formData, "lastName", 120);
  const birthday = readText(formData, "birthday", 10);
  const pdfTemplate = readText(formData, "pdfTemplate", 20) || "qts-standard";
  const candidateEmail = readText(formData, "candidateEmail", 320);
  const phone = readText(formData, "phone", 64);
  const headline = readText(formData, "headline", 256);
  const linkedinUrl = readText(formData, "linkedinUrl", 2048);
  const country = readText(formData, "country", 120);
  const city = readText(formData, "city", 120);
  const province = readText(formData, "province", 120);
  const addressLine1 = readText(formData, "addressLine1", 256);
  const postalCode = readText(formData, "postalCode", 32);
  const subCategoryId = readText(formData, "subCategoryId", 36);
  const educationRows = normalizeEducationRows(readHistoryRows(formData, "education", {
    institution: 120,
    degree: 120,
    fieldOfStudy: 120,
    startDate: 7,
    endDate: 7,
    isCurrent: 5,
    description: 5000,
  }));
  const experienceRows = readHistoryRows(formData, "experience", {
    companyName: 160,
    jobTitle: 160,
    location: 160,
    startDate: 7,
    endDate: 7,
    isCurrent: 5,
    description: 5000,
  });
  if (
    expectedRole === "account" &&
    [
      ["birthday", 10],
      ["candidateEmail", 320],
      ["phone", 64],
      ["linkedinUrl", 2048],
    ].some(([name, maxLength]) => {
      const value = formData.get(String(name));
      return value !== null &&
        (typeof value !== "string" || value.length > Number(maxLength));
    })
  ) {
    return { ...emptyState, error: "One or more profile fields are missing or too long." };
  }
  if (!educationRows || !experienceRows) {
    return {
      ...emptyState,
      error: "History forms are invalid or contain too many entries (maximum 20 each).",
    };
  }

  if (expectedRole !== "account" && password.length < minimumPasswordLength) {
    return {
      ...emptyState,
      error: passwordLengthError(),
    };
  }

  const normalizedLinkedInUrl =
    expectedRole === "account" ? normalizeLinkedInProfile(linkedinUrl) : "";
  if (expectedRole === "account") {
    if (!firstName || !lastName) {
      return {
        ...emptyState,
        error: "Enter the candidate's first and last name.",
      };
    }
    if (candidateEmail && !isValidProfileEmail(candidateEmail)) {
      return { ...emptyState, error: "Enter a valid candidate email address." };
    }
    if (phone && !isValidProfilePhone(phone)) {
      return { ...emptyState, error: "Enter a valid phone number with 7 to 15 digits." };
    }
    if (birthday && !isValidBirthday(birthday)) {
      return { ...emptyState, error: "Enter a valid birthday that is not in the future." };
    }
    if (!isPdfTemplate(pdfTemplate)) {
      return { ...emptyState, error: "Select a valid PDF template." };
    }
    if (normalizedLinkedInUrl === null) {
      return { ...emptyState, error: "Enter a LinkedIn profile as linkedin.com/in/username." };
    }
    if (subCategoryId && !isUuid(subCategoryId)) {
      return { ...emptyState, error: "Select a valid candidate subcategory." };
    }
    if (subCategoryId) {
      const [subCategory] = await db.select({ id: subCategories.id })
        .from(subCategories)
        .where(eq(subCategories.id, subCategoryId))
        .limit(1);
      if (!subCategory) {
        return { ...emptyState, error: "That candidate subcategory no longer exists. Refresh and try again." };
      }
    }
    const educationError = validateEducationRows(educationRows);
    if (educationError) return { ...emptyState, error: educationError };
    const experienceError = validateExperienceRows(experienceRows);
    if (experienceError) return { ...emptyState, error: experienceError };
  } else if (!loginName) {
    return {
      ...emptyState,
      error: "Enter a login name for the staff account.",
    };
  }

  try {
    if (expectedRole === "account") {
      const educationEntries = sortProfileHistoryNewestFirst(educationRows)
        .filter((row) => row.institution)
        .map((row, sortOrder) => ({
          institution: row.institution,
          degree: row.degree || null,
          field_of_study: row.fieldOfStudy || null,
          start_date: toDatabaseMonth(row.startDate),
          end_date: toDatabaseMonth(row.endDate),
          is_current: row.isCurrent === "true",
          description: row.description || null,
          sort_order: sortOrder,
        }));
      const experienceEntries = sortProfileHistoryNewestFirst(experienceRows)
        .filter((row) => row.companyName && row.jobTitle)
        .map((row, sortOrder) => ({
          company_name: row.companyName,
          job_title: row.jobTitle,
          location: row.location || null,
          start_date: toDatabaseMonth(row.startDate),
          end_date: toDatabaseMonth(row.endDate),
          is_current: row.isCurrent === "true",
          description: row.description || null,
          sort_order: sortOrder,
        }));

      await db.execute(sql`
        with new_user as (
          insert into users (role, parent_user_id, display_name, login_name, password_hash)
          values ('account', ${actor.id}, null, null, null)
          returning id
        ),
        new_profile as (
          insert into profiles (
            user_id, category_id, first_name, last_name, birthday, pdf_template, candidate_email, phone,
            headline, linkedin_url, country, city, province, address_line_1,
            postal_code
          )
          select id, ${subCategoryId || null}::uuid, ${firstName}, ${lastName},
            ${birthday || null}::date, ${pdfTemplate},
            ${candidateEmail ? candidateEmail.toLowerCase() : null},
            ${phone || null}, ${headline || null}, ${normalizedLinkedInUrl || null},
            ${country || null}, ${city || null}, ${province || null},
            ${addressLine1 || null}, ${postalCode || null}
          from new_user
          returning user_id
        ),
        inserted_educations as (
          insert into educations (
            profile_user_id, institution, degree, field_of_study, start_date,
            end_date, is_current, description, sort_order
          )
          select new_profile.user_id, entry.institution, entry.degree,
            entry.field_of_study, entry.start_date, entry.end_date,
            entry.is_current, entry.description, entry.sort_order
          from new_profile
          cross join jsonb_to_recordset(${JSON.stringify(educationEntries)}::jsonb)
            as entry(
              institution text, degree text, field_of_study text, start_date date,
              end_date date, is_current boolean, description text, sort_order integer
            )
          returning id
        ),
        inserted_experiences as (
          insert into experiences (
            profile_user_id, company_name, job_title, location, start_date,
            end_date, is_current, description, sort_order
          )
          select new_profile.user_id, entry.company_name, entry.job_title,
            entry.location, entry.start_date, entry.end_date, entry.is_current,
            entry.description, entry.sort_order
          from new_profile
          cross join jsonb_to_recordset(${JSON.stringify(experienceEntries)}::jsonb)
            as entry(
              company_name text, job_title text, location text, start_date date,
              end_date date, is_current boolean, description text, sort_order integer
            )
          returning id
        )
        select user_id from new_profile
      `);
    } else {
      const passwordHash = await hashPassword(password);
      await db.insert(users).values({
        role: expectedRole,
        parentUserId: actor.id,
        displayName: expectedRole === "admin" ? "Admin" : "Manager",
        loginName,
        passwordHash,
      });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ...emptyState,
        error:
          expectedRole === "account"
            ? "That candidate email is already in use."
            : "That login name is already in use.",
      };
    }
    logUserActionFailure("creating a user", error);
    return {
      ...emptyState,
      error: "The user could not be created. Please try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/users");
  return {
    error: null,
    success:
      expectedRole === "account"
        ? "Candidate profile created."
        : `${expectedRole === "admin" ? "Admin" : "Manager"} account created.`,
  };
}

export async function updateCandidateProfileAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") {
    return {
      ...emptyState,
      error: "Only Managers can update candidate profiles.",
    };
  }

  const userId = readText(formData, "userId", 64);
  if (!isUuid(userId)) {
    return { ...emptyState, error: "Select a valid candidate account." };
  }

  const limits = {
    firstName: 120,
    lastName: 120,
    birthday: 10,
    pdfTemplate: 20,
    candidateEmail: 320,
    phone: 64,
    headline: 256,
    linkedinUrl: 2048,
    country: 120,
    city: 120,
    province: 120,
    addressLine1: 256,
    postalCode: 32,
    jdMatching: 5000,
    subCategoryId: 36,
  } as const;
  const values = {
    firstName: readText(formData, "firstName", limits.firstName),
    lastName: readText(formData, "lastName", limits.lastName),
    birthday: readText(formData, "birthday", limits.birthday),
    pdfTemplate: readText(formData, "pdfTemplate", limits.pdfTemplate) || "qts-standard",
    candidateEmail: readText(formData, "candidateEmail", limits.candidateEmail),
    phone: readText(formData, "phone", limits.phone),
    headline: readText(formData, "headline", limits.headline),
    linkedinUrl: readText(formData, "linkedinUrl", limits.linkedinUrl),
    country: readText(formData, "country", limits.country),
    city: readText(formData, "city", limits.city),
    province: readText(formData, "province", limits.province),
    addressLine1: readText(formData, "addressLine1", limits.addressLine1),
    postalCode: readText(formData, "postalCode", limits.postalCode),
    jdMatching: readText(formData, "jdMatching", limits.jdMatching),
    subCategoryId: readText(formData, "subCategoryId", limits.subCategoryId),
  };
  const educationRows = normalizeEducationRows(readHistoryRows(formData, "education", {
    institution: 120,
    degree: 120,
    fieldOfStudy: 120,
    startDate: 7,
    endDate: 7,
    isCurrent: 5,
    description: 5000,
  }));
  const experienceRows = readHistoryRows(formData, "experience", {
    companyName: 160,
    jobTitle: 160,
    location: 160,
    startDate: 7,
    endDate: 7,
    isCurrent: 5,
    description: 5000,
  });
  if (
    Object.entries(limits).some(([name, maxLength]) => {
      const value = formData.get(name);
      return typeof value !== "string" || value.length > maxLength;
    })
  ) {
    return { ...emptyState, error: "One or more profile fields are missing or too long." };
  }
  if (!educationRows || !experienceRows) {
    return {
      ...emptyState,
      error: "History forms are invalid or contain too many entries (maximum 20 each).",
    };
  }

  if (!values.firstName || !values.lastName) {
    return {
      ...emptyState,
      error: "Enter the candidate's first and last name.",
    };
  }
  if (values.candidateEmail && !isValidProfileEmail(values.candidateEmail)) {
    return { ...emptyState, error: "Enter a valid candidate email address." };
  }
  if (values.phone && !isValidProfilePhone(values.phone)) {
    return { ...emptyState, error: "Enter a valid phone number with 7 to 15 digits." };
  }
  if (values.birthday && !isValidBirthday(values.birthday)) {
    return { ...emptyState, error: "Enter a valid birthday that is not in the future." };
  }
  if (!isPdfTemplate(values.pdfTemplate)) {
    return { ...emptyState, error: "Select a valid PDF template." };
  }
  const normalizedLinkedInUrl = normalizeLinkedInProfile(values.linkedinUrl);
  if (normalizedLinkedInUrl === null) {
    return { ...emptyState, error: "Enter a LinkedIn profile as linkedin.com/in/username." };
  }
  if (values.subCategoryId && !isUuid(values.subCategoryId)) {
    return { ...emptyState, error: "Select a valid candidate subcategory." };
  }
  const educationError = validateEducationRows(educationRows);
  if (educationError) return { ...emptyState, error: educationError };
  const experienceError = validateExperienceRows(experienceRows);
  if (experienceError) return { ...emptyState, error: experienceError };

  try {
    if (values.subCategoryId) {
      const [category] = await db
        .select({ id: subCategories.id })
        .from(subCategories)
        .where(eq(subCategories.id, values.subCategoryId))
        .limit(1);
      if (!category) {
        return {
          ...emptyState,
          error: "That candidate subcategory no longer exists. Refresh and try again.",
        };
      }
    }

    const educationEntries = sortProfileHistoryNewestFirst(educationRows)
      .filter((row) => row.institution)
      .map((row, sortOrder) => ({
        institution: row.institution,
        degree: row.degree || null,
        field_of_study: row.fieldOfStudy || null,
        start_date: toDatabaseMonth(row.startDate),
        end_date: toDatabaseMonth(row.endDate),
        is_current: row.isCurrent === "true",
        description: row.description || null,
        sort_order: sortOrder,
      }));
    const experienceEntries = sortProfileHistoryNewestFirst(experienceRows)
      .filter((row) => row.companyName && row.jobTitle)
      .map((row, sortOrder) => ({
        company_name: row.companyName,
        job_title: row.jobTitle,
        location: row.location || null,
        start_date: toDatabaseMonth(row.startDate),
        end_date: toDatabaseMonth(row.endDate),
        is_current: row.isCurrent === "true",
        description: row.description || null,
        sort_order: sortOrder,
      }));
    const results = await neonSql.transaction((tx) => [
      tx`
        update profiles
        set category_id = ${values.subCategoryId || null}::uuid,
          first_name = ${values.firstName}, last_name = ${values.lastName},
          birthday = ${values.birthday || null}::date,
          pdf_template = ${values.pdfTemplate},
          candidate_email = ${values.candidateEmail ? values.candidateEmail.toLowerCase() : null},
          phone = ${values.phone || null}, headline = ${values.headline || null},
          linkedin_url = ${normalizedLinkedInUrl || null}, country = ${values.country || null},
          city = ${values.city || null}, province = ${values.province || null},
          address_line_1 = ${values.addressLine1 || null}, postal_code = ${values.postalCode || null},
          jd_matching = ${values.jdMatching || null},
          updated_at = now()
        where profiles.user_id = ${userId}::uuid
          and exists (
            select 1 from users
            where users.id = profiles.user_id and users.role = 'account'
              and users.parent_user_id = ${actor.id}::uuid and users.blocked_at is null
          )
        returning profiles.user_id
      `,
      tx`
        delete from educations using users
        where educations.profile_user_id = users.id and users.id = ${userId}::uuid
          and users.role = 'account' and users.parent_user_id = ${actor.id}::uuid
          and users.blocked_at is null
      `,
      tx`
        insert into educations (
          profile_user_id, institution, degree, field_of_study, start_date,
          end_date, is_current, description, sort_order
        )
        select users.id, entry.institution, entry.degree, entry.field_of_study,
          entry.start_date, entry.end_date, entry.is_current, entry.description, entry.sort_order
        from users
        cross join jsonb_to_recordset(${JSON.stringify(educationEntries)}::jsonb)
          as entry(institution text, degree text, field_of_study text, start_date date,
            end_date date, is_current boolean, description text, sort_order integer)
        where users.id = ${userId}::uuid and users.role = 'account'
          and users.parent_user_id = ${actor.id}::uuid and users.blocked_at is null
      `,
      tx`
        delete from experiences using users
        where experiences.profile_user_id = users.id and users.id = ${userId}::uuid
          and users.role = 'account' and users.parent_user_id = ${actor.id}::uuid
          and users.blocked_at is null
      `,
      tx`
        insert into experiences (
          profile_user_id, company_name, job_title, location, start_date,
          end_date, is_current, description, sort_order
        )
        select users.id, entry.company_name, entry.job_title, entry.location,
          entry.start_date, entry.end_date, entry.is_current, entry.description, entry.sort_order
        from users
        cross join jsonb_to_recordset(${JSON.stringify(experienceEntries)}::jsonb)
          as entry(company_name text, job_title text, location text, start_date date,
            end_date date, is_current boolean, description text, sort_order integer)
        where users.id = ${userId}::uuid and users.role = 'account'
          and users.parent_user_id = ${actor.id}::uuid and users.blocked_at is null
      `,
    ]);

    if (results[0].length === 0) {
      return {
        ...emptyState,
        error: "That active candidate account was not found in your team.",
      };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ...emptyState,
        error: "That candidate email is already in use.",
      };
    }
    logUserActionFailure("updating a candidate profile", error);
    return {
      ...emptyState,
      error: "The candidate profile could not be updated. Please try again.",
    };
  }

  revalidatePath("/users");
  revalidatePath("/");
  return { error: null, success: "Candidate profile updated." };
}

export async function updateUserCredentialsAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can update other users." };
  }

  const userId = readText(formData, "userId", 64);
  const loginName = readText(formData, "loginName", 128);
  const password = readSecret(formData, "password");
  if (!isUuid(userId)) {
    return { ...emptyState, error: "Select a valid staff account." };
  }
  if (!loginName && !password) {
    return {
      ...emptyState,
      error: "Enter a login name or a new password.",
    };
  }
  if (password && password.length < minimumPasswordLength) {
    return {
      ...emptyState,
      error: passwordLengthError("A new password"),
    };
  }

  let passwordHash: string | undefined;
  if (password) passwordHash = await hashPassword(password);

  try {
    const [updatedUser] = await db
      .update(users)
      .set({
        ...(loginName ? { loginName } : {}),
        ...(passwordHash
          ? {
              passwordHash,
              authVersion: sql`${users.authVersion} + 1`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, userId),
          sql`${users.role} in ('super_admin', 'admin', 'manager')`,
        ),
      )
      .returning({ id: users.id });

    if (!updatedUser) {
      return {
        ...emptyState,
        error: "That staff account was not found.",
      };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ...emptyState,
        error: "That login name is already in use.",
      };
    }
    logUserActionFailure("updating staff credentials", error);
    return {
      ...emptyState,
      error: "Credentials could not be updated. Please try again.",
    };
  }

  revalidatePath("/users");
  revalidatePath("/");
  return { error: null, success: "Staff credentials updated." };
}

export async function deleteCandidateAccountAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") {
    return {
      ...emptyState,
      error: "Only Managers can delete candidate accounts.",
    };
  }

  const userId = readText(formData, "userId", 64);
  if (!isUuid(userId)) {
    return { ...emptyState, error: "Select a valid candidate account." };
  }

  try {
    const results = await neonSql.transaction((tx) => [
      tx`
        delete from bids
        using users as candidate
        where bids.candidate_id = candidate.id
          and candidate.id = ${userId}::uuid
          and candidate.role = 'account'
          and candidate.parent_user_id = ${actor.id}::uuid
      `,
      tx`
        delete from jobs
        using users as candidate
        where jobs.candidate_id = candidate.id
          and candidate.id = ${userId}::uuid
          and candidate.role = 'account'
          and candidate.parent_user_id = ${actor.id}::uuid
      `,
      tx`
        delete from profiles
        using users as candidate
        where profiles.user_id = candidate.id
          and candidate.id = ${userId}::uuid
          and candidate.role = 'account'
          and candidate.parent_user_id = ${actor.id}::uuid
      `,
      tx`
        delete from users
        where users.id = ${userId}::uuid
          and users.role = 'account'
          and users.parent_user_id = ${actor.id}::uuid
        returning users.id
      `,
    ]);

    if (results[3].length === 0) {
      return {
        ...emptyState,
        error: "That candidate account was not found in your team.",
      };
    }
  } catch (error) {
    logUserActionFailure("deleting a candidate account", error);
    return {
      ...emptyState,
      error: "The candidate account could not be deleted. Please try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/users");
  return { error: null, success: "Candidate account permanently deleted." };
}

export async function deleteStaffUserAction(
  _previousState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can delete staff users." };
  }

  const userId = readText(formData, "userId", 64);
  const replacementUserId = readText(formData, "replacementUserId", 64);
  if (!isUuid(userId)) {
    return { ...emptyState, error: "Select a valid staff account." };
  }
  if (replacementUserId && !isUuid(replacementUserId)) {
    return { ...emptyState, error: "Select a valid replacement user." };
  }

  let reassignedCount = 0;
  try {
    const [reassigned, deleted] = await neonSql.transaction((tx) => [
      tx`
        update users as child
        set parent_user_id = replacement.id, updated_at = now()
        from users as target
        inner join users as replacement
          on replacement.id = ${replacementUserId || null}::uuid
          and replacement.role = target.role
          and replacement.parent_user_id = target.parent_user_id
          and replacement.id <> target.id
          and replacement.blocked_at is null
        where target.id = ${userId}::uuid
          and target.role in ('admin', 'manager')
          and child.parent_user_id = target.id
          and not exists (
            select 1 from users as blocked_user
            where blocked_user.blocked_by = target.id
          )
        returning child.id
      `,
      tx`
        delete from users as target
        where target.id = ${userId}::uuid
          and target.role in ('admin', 'manager')
          and not exists (
            select 1 from users as child
            where child.parent_user_id = target.id
          )
          and not exists (
            select 1 from users as blocked_user
            where blocked_user.blocked_by = target.id
          )
        returning target.id
      `,
    ]);
    reassignedCount = reassigned.length;

    if (deleted.length === 0) {
      const [target] = await db.execute<{
        role: string;
        hasReports: boolean;
        isBlockAuditor: boolean;
      }>(sql`
        select
          target.role,
          exists (
            select 1 from users as child
            where child.parent_user_id = target.id
          ) as "hasReports",
          exists (
            select 1 from users as blocked_user
            where blocked_user.blocked_by = target.id
          ) as "isBlockAuditor"
        from users as target
        where target.id = ${userId}::uuid
      `).then((result) => result.rows);

      if (!target || !["admin", "manager"].includes(target.role)) {
        return { ...emptyState, error: "That Admin or Manager was not found." };
      }
      if (target.hasReports && !replacementUserId) {
        return {
          ...emptyState,
          error: "Choose an active peer to receive this user's reports.",
        };
      }
      if (target.hasReports && reassigned.length === 0) {
        return {
          ...emptyState,
          error:
            "The selected replacement is unavailable or not an eligible peer. Refresh and choose another active peer.",
        };
      }
      if (target.isBlockAuditor) {
        return {
          ...emptyState,
          error:
            "This user is recorded as the blocker for another account. Resolve that audit reference before deleting them.",
        };
      }
      return {
        ...emptyState,
        error: "This account could not be deleted. Refresh and try again.",
      };
    }
  } catch (error) {
    logUserActionFailure("deleting a staff user", error);
    return {
      ...emptyState,
      error: isForeignKeyViolation(error)
        ? "This account could not be deleted because related records still depend on it."
        : "This account could not be deleted. Please try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/users");
  return {
    error: null,
    success: reassignedCount
      ? `Staff account deleted; ${reassignedCount} direct report(s) reassigned to the selected peer.`
      : "Staff account permanently deleted.",
  };
}

function readText(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= maxLength
    ? value.trim()
    : "";
}

function readSecret(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= 1024 ? value : "";
}

function readHistoryRows(
  formData: FormData,
  prefix: string,
  fieldLimits: Record<string, number>,
): Record<string, string>[] | null {
  const fields: [string, string[]][] = [];
  for (const [name, maxLength] of Object.entries(fieldLimits)) {
    const rawValues = formData.getAll(
      `${prefix}${name[0]?.toUpperCase()}${name.slice(1)}`,
    );
    if (rawValues.length > 20) return null;
    const values: string[] = [];
    for (const value of rawValues) {
      if (typeof value !== "string" || value.length > maxLength) return null;
      values.push(value.trim());
    }
    fields.push([name, values]);
  }
  const rowCount = fields[0]?.[1].length ?? 0;
  if (fields.some(([, values]) => values.length !== rowCount)) return null;

  return Array.from({ length: rowCount }, (_, index) =>
    Object.fromEntries(fields.map(([name, values]) => [name, values[index]])),
  );
}

function normalizeEducationRows(
  rows: Record<string, string>[] | null,
): Record<string, string>[] | null {
  return rows?.map((row) => {
    row.isCurrent = "false";
    return row;
  }) ?? null;
}

function validateEducationRows(rows: Record<string, string>[]): string | null {
  for (const [index, row] of rows.entries()) {
    const hasDetails = Object.entries(row).some(
      ([key, value]) => key !== "isCurrent" && value !== "",
    );
    if (!hasDetails && row.isCurrent !== "true") continue;
    if (!row.institution) {
      return `Enter an institution for education entry ${index + 1}.`;
    }
    const dateError = validateHistoryDates(row, index, "education");
    if (dateError) return dateError;
  }
  return null;
}

function validateExperienceRows(rows: Record<string, string>[]): string | null {
  for (const [index, row] of rows.entries()) {
    const hasDetails = Object.entries(row).some(
      ([key, value]) => key !== "isCurrent" && value !== "",
    );
    if (!hasDetails && row.isCurrent !== "true") continue;
    if (!row.companyName || !row.jobTitle) {
      return `Enter both an employer and job title for experience entry ${index + 1}.`;
    }
    const dateError = validateHistoryDates(row, index, "experience");
    if (dateError) return dateError;
  }
  return null;
}

function validateHistoryDates(
  row: Record<string, string>,
  index: number,
  label: string,
): string | null {
  const startDate = row.startDate ?? "";
  const endDate = row.endDate ?? "";
  const isCurrent = row.isCurrent === "true";
  if (startDate && !isValidProfileMonth(startDate)) {
    return `Enter a valid start month for ${label} entry ${index + 1}.`;
  }
  if (endDate && !isValidProfileMonth(endDate)) {
    return `Enter a valid end month for ${label} entry ${index + 1}.`;
  }
  if (isCurrent && endDate) {
    return `Clear the end month for current ${label} entry ${index + 1}.`;
  }
  if (
    startDate &&
    endDate &&
    (profileMonthOrdinal(endDate) ?? 0) < (profileMonthOrdinal(startDate) ?? 0)
  ) {
    return `The end month cannot be before the start month for ${label} entry ${index + 1}.`;
  }
  if (row.isCurrent !== "true" && row.isCurrent !== "false") {
    return `Invalid current status for ${label} entry ${index + 1}.`;
  }
  return null;
}

function toDatabaseMonth(value: string): string | null {
  if (!value) return null;
  const [month, year] = value.split("/");
  return `${year}-${month}-01`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23503"
  );
}

function logUserActionFailure(stage: string, error: unknown): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`User action failed while ${stage} (code: ${code}).`);
}
