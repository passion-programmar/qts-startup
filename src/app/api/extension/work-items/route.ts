import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { categories, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { hasEligibleExperienceCount, hasMatchingNote, readyApply, readyAutoApply, readyGeneration, readyGenerationJob } from "@/server/work/work-eligibility";
import { matchesManagerCustomUrl } from "@/server/work/custom-urls";
import { isWorkId } from "@/server/work/work-selection";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return reply({ success: false, message: "Sign in to load your accounts and jobs." }, 401);
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode"), candidateId = params.get("candidateId");
  // "all" lists the accounts once with every mode's ready count (one shared candidate in the panel);
  // "apply" lists a candidate's jobs for manual Apply. The per-mode account lists stay for older extensions.
  if (!["generation", "apply", "auto_apply", "all"].includes(mode || "") || (candidateId !== null && !isWorkId(candidateId))
    || (mode === "all" && candidateId !== null) || (mode === "apply" && candidateId === null)) {
    return reply({ success: false, message: "A valid work mode and account are required." }, 400);
  }
  try {
    const [managerRow] = await db.select({ useGeminiMatching: users.useGeminiMatching }).from(users).where(eq(users.id, manager.id)).limit(1);
    const requireMatchingNote = managerRow?.useGeminiMatching === true;
    const managed = and(eq(users.parentUserId, manager.id), eq(users.role, "account"), isNull(users.blockedAt));
    // Generation and Auto Apply also need the account's experience (and matching note); Apply does not.
    const qualified = and(hasEligibleExperienceCount(), requireMatchingNote ? hasMatchingNote() : sql`true`);
    const ownership = mode === "apply" ? managed : and(managed, qualified);
    if (mode === "all") {
      const accounts = await db.select({
        id: profiles.userId,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        category: profiles.managerCategory,
        categoryColor: profiles.managerCategoryColor,
        categoryName: categories.name,
        qualified: sql<boolean>`${qualified}`,
        generation: sql<number>`count(${jobs.id}) filter (where ${readyGenerationJob(new Date())})::int`,
        apply: sql<number>`count(${jobs.id}) filter (where ${readyApply()})::int`,
        autoApply: sql<number>`count(${jobs.id}) filter (where ${readyAutoApply()})::int`,
      })
        .from(users)
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .innerJoin(categories, eq(categories.id, profiles.categoryId))
        .leftJoin(jobs, and(eq(jobs.candidateId, users.id), eq(jobs.managerId, manager.id)))
        .where(managed)
        .groupBy(users.id, profiles.userId, categories.id)
        .orderBy(asc(profiles.firstName), asc(profiles.lastName)).limit(101);
      if (accounts.length > 100) return reply({ success: false, message: "Too many accounts to list. Contact your administrator." }, 413);
      return reply({ success: true, accounts: accounts.map((account) => ({
        id: account.id,
        name: [account.firstName, account.lastName].filter(Boolean).join(" ") || "Candidate",
        category: account.category || "",
        categoryColor: account.categoryColor || null,
        categoryName: account.categoryName || "Global",
        counts: {
          generation: account.qualified === true ? Number(account.generation) || 0 : 0,
          apply: Number(account.apply) || 0,
          auto_apply: account.qualified === true ? Number(account.autoApply) || 0 : 0,
        },
      })) });
    }
    if (candidateId === null) {
      const accounts = await db.select({
        id: profiles.userId,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        category: profiles.managerCategory,
        categoryColor: profiles.managerCategoryColor,
        categoryName: categories.name,
        eligibleJobCount: sql<number>`count(${jobs.id})::int`,
      })
        .from(users)
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .innerJoin(categories, eq(categories.id, profiles.categoryId))
        .leftJoin(jobs, and(
          eq(jobs.candidateId, users.id),
          eq(jobs.managerId, manager.id),
          mode === "generation" ? readyGeneration(new Date(), requireMatchingNote) : readyAutoApply(),
        ))
        .where(ownership)
        .groupBy(users.id, profiles.userId, profiles.firstName, profiles.lastName, profiles.managerCategory, profiles.managerCategoryColor, categories.name)
        .orderBy(asc(profiles.firstName), asc(profiles.lastName)).limit(101);
      if (accounts.length > 100) return reply({ success: false, message: "Too many accounts to list. Contact your administrator." }, 413);
      return reply({ success: true, accounts: accounts.map(({ id, firstName, lastName, category, categoryColor, categoryName, eligibleJobCount }) => ({
        id,
        name: [firstName, lastName].filter(Boolean).join(" ") || "Candidate",
        category: category || "",
        categoryColor: categoryColor || null,
        // The account's category (e.g. Engineering); category above is the Manager's label for it.
        categoryName: categoryName || "Global",
        eligibleJobCount: Number(eligibleJobCount) || 0,
      })) });
    }
    const [account] = await db.select({ id: users.id }).from(users).innerJoin(profiles, eq(profiles.userId, users.id))
      .where(and(ownership, eq(users.id, candidateId))).limit(1);
    if (!account) return reply({ success: false, message: requireMatchingNote ? "This account is unavailable or has no matching note." : "This account is unavailable or inactive." }, 403);
    const rows = await db.select({
      id: jobs.id,
      title: jobs.jobTitle,
      company: jobs.company,
      url: jobs.jobUrl,
      customUrl: mode === "apply" || mode === "auto_apply"
        ? matchesManagerCustomUrl(manager.id, jobs.jobUrl)
        : sql<boolean>`false`,
      busy: mode === "auto_apply" ? sql<boolean>`exists (
        select 1 from apply_attempts a where a.job_id = ${jobs.id}
          and (a.status in ('waiting_confirmation', 'submitting')
            or (a.status in ('claimed', 'waiting_review') and a.lease_expires_at > now()))
      )` : sql<boolean>`false`,
    })
      .from(jobs).innerJoin(users, eq(users.id, jobs.candidateId)).innerJoin(profiles, eq(profiles.userId, users.id))
      .where(and(ownership, eq(jobs.managerId, manager.id), eq(jobs.candidateId, candidateId),
        mode === "generation" ? readyGeneration(new Date(), requireMatchingNote) : mode === "apply" ? readyApply() : readyAutoApply()))
      .orderBy(asc(jobs.createdAt), asc(jobs.id)).limit(201);
    const jobsToShow = rows.slice(0, 200);
    return reply({
      success: true,
      jobs: mode === "auto_apply"
        ? jobsToShow.map(({ busy, ...job }) => {
          const inProgress = busy === true;
          return { ...job, customUrl: job.customUrl === true, busy: inProgress, selectable: !inProgress };
        })
        : mode === "apply"
          ? jobsToShow.map(({ id, title, company, url, customUrl }) => ({ id, title, company, url, customUrl: customUrl === true }))
          : jobsToShow.map(({ id, title, company, url }) => ({ id, title, company, url })),
      hasMore: rows.length > 200,
    });
  } catch (error) {
    console.error("Could not load extension work items.", error);
    return reply({ success: false, message: "QTS could not load your accounts or jobs. Try again." }, 500);
  }
}
