"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { categories, profiles, users } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireUser } from "@/lib/session";

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
  const candidateEmail = readText(formData, "candidateEmail", 320);
  const phone = readText(formData, "phone", 64);
  const headline = readText(formData, "headline", 256);
  const linkedinUrl = readText(formData, "linkedinUrl", 2048);
  const country = readText(formData, "country", 120);
  const city = readText(formData, "city", 120);
  const province = readText(formData, "province", 120);
  const addressLine1 = readText(formData, "addressLine1", 256);
  const postalCode = readText(formData, "postalCode", 32);
  const categoryId = readText(formData, "categoryId", 36);
  const educationRows = readHistoryRows(formData, "education", {
    institution: 120,
    degree: 120,
    fieldOfStudy: 120,
    startDate: 7,
    endDate: 7,
    isCurrent: 5,
    description: 5000,
  });
  const experienceRows = readHistoryRows(formData, "experience", {
    companyName: 160,
    jobTitle: 160,
    location: 160,
    startDate: 7,
    endDate: 7,
    isCurrent: 5,
    description: 5000,
  });
  if (!educationRows || !experienceRows) {
    return {
      ...emptyState,
      error: "History forms are invalid or contain too many entries (maximum 20 each).",
    };
  }

  if (expectedRole !== "account" && password.length < 4) {
    return {
      ...emptyState,
      error: "The password must be at least 4 characters.",
    };
  }

  if (expectedRole === "account") {
    if (!firstName || !lastName) {
      return {
        ...emptyState,
        error: "Enter the candidate's first and last name.",
      };
    }
    if (candidateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
      return { ...emptyState, error: "Enter a valid candidate email address." };
    }
    if (linkedinUrl && !isHttpUrl(linkedinUrl)) {
      return { ...emptyState, error: "Enter a valid LinkedIn profile URL." };
    }
    if (categoryId && !isUuid(categoryId)) {
      return { ...emptyState, error: "Select a valid candidate category." };
    }
    const educationError = validateEducationRows(educationRows);
    if (educationError) return { ...emptyState, error: educationError };
    const experienceError = validateExperienceRows(experienceRows);
    if (experienceError) return { ...emptyState, error: experienceError };
  } else if (!loginName) {
    return {
      ...emptyState,
      error: "Enter a username for the staff account.",
    };
  }

  try {
    if (expectedRole === "account") {
      const educationEntries = educationRows
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
      const experienceEntries = experienceRows
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
            user_id, category_id, first_name, last_name, candidate_email, phone,
            headline, linkedin_url, country, city, province, address_line_1,
            postal_code
          )
          select id, ${categoryId || null}::uuid, ${firstName}, ${lastName},
            ${candidateEmail ? candidateEmail.toLowerCase() : null},
            ${phone || null}, ${headline || null}, ${linkedinUrl || null},
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
    candidateEmail: 320,
    phone: 64,
    headline: 256,
    linkedinUrl: 2048,
    country: 120,
    city: 120,
    province: 120,
    addressLine1: 256,
    postalCode: 32,
    categoryId: 36,
  } as const;
  const values = {
    firstName: readText(formData, "firstName", limits.firstName),
    lastName: readText(formData, "lastName", limits.lastName),
    candidateEmail: readText(formData, "candidateEmail", limits.candidateEmail),
    phone: readText(formData, "phone", limits.phone),
    headline: readText(formData, "headline", limits.headline),
    linkedinUrl: readText(formData, "linkedinUrl", limits.linkedinUrl),
    country: readText(formData, "country", limits.country),
    city: readText(formData, "city", limits.city),
    province: readText(formData, "province", limits.province),
    addressLine1: readText(formData, "addressLine1", limits.addressLine1),
    postalCode: readText(formData, "postalCode", limits.postalCode),
    categoryId: readText(formData, "categoryId", limits.categoryId),
  };
  if (
    Object.entries(limits).some(([name, maxLength]) => {
      const value = formData.get(name);
      return typeof value !== "string" || value.length > maxLength;
    })
  ) {
    return { ...emptyState, error: "One or more profile fields are invalid." };
  }

  if (!values.firstName || !values.lastName) {
    return {
      ...emptyState,
      error: "Enter the candidate's first and last name.",
    };
  }
  if (
    values.candidateEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.candidateEmail)
  ) {
    return { ...emptyState, error: "Enter a valid candidate email address." };
  }
  if (values.linkedinUrl && !isHttpUrl(values.linkedinUrl)) {
    return { ...emptyState, error: "Enter a valid LinkedIn profile URL." };
  }
  if (values.categoryId && !isUuid(values.categoryId)) {
    return { ...emptyState, error: "Select a valid candidate category." };
  }

  try {
    if (values.categoryId) {
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, values.categoryId))
        .limit(1);
      if (!category) {
        return {
          ...emptyState,
          error: "That candidate category no longer exists. Refresh and try again.",
        };
      }
    }

    const [updatedProfile] = await db
      .update(profiles)
      .set({
        categoryId: values.categoryId || null,
        firstName: values.firstName,
        lastName: values.lastName,
        candidateEmail: values.candidateEmail
          ? values.candidateEmail.toLowerCase()
          : null,
        phone: values.phone || null,
        headline: values.headline || null,
        linkedinUrl: values.linkedinUrl || null,
        country: values.country || null,
        city: values.city || null,
        province: values.province || null,
        addressLine1: values.addressLine1 || null,
        postalCode: values.postalCode || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(profiles.userId, userId),
          sql`exists (
            select 1 from users
            where users.id = ${profiles.userId}
              and users.role = 'account'
              and users.parent_user_id = ${actor.id}
              and users.blocked_at is null
          )`,
        ),
      )
      .returning({ userId: profiles.userId });

    if (!updatedProfile) {
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
  if (!isUuid(userId) || (!loginName && !password)) {
    return {
      ...emptyState,
      error: "Enter a login name or a new password.",
    };
  }
  if (password && password.length < 4) {
    return {
      ...emptyState,
      error: "A new password must be at least 4 characters.",
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
      error:
        "This account could not be deleted because related records still depend on it.",
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
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/;

  if (startDate && !validMonth.test(startDate)) {
    return `Enter a valid start month for ${label} entry ${index + 1}.`;
  }
  if (endDate && !validMonth.test(endDate)) {
    return `Enter a valid end month for ${label} entry ${index + 1}.`;
  }
  if (isCurrent && endDate) {
    return `Clear the end month for current ${label} entry ${index + 1}.`;
  }
  if (startDate && endDate && endDate < startDate) {
    return `The end month cannot be before the start month for ${label} entry ${index + 1}.`;
  }
  if (row.isCurrent !== "true" && row.isCurrent !== "false") {
    return `Invalid current status for ${label} entry ${index + 1}.`;
  }
  return null;
}

function toDatabaseMonth(value: string): string | null {
  return value ? `${value}-01` : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
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
