import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { MIN_WORK_EXTENSION_VERSION } from "@/server/apply/apply-values";
import { resolveExtensionBrowser } from "@/server/browsers/extension-browsers";
import { generationFree, generationHeld, holdUntil } from "@/server/generation/generation-hold";
import { DEFAULT_GENERATION_PARALLEL_LIMIT, MAX_GENERATION_PARALLEL_LIMIT } from "@/server/generation/generation-values";
import { effectiveJobDescription, hasEffectiveJobDescription } from "@/server/jobs/job-description";
import { hasEligibleExperienceCount } from "@/server/work/work-eligibility";
import { readWorkSelection } from "@/server/work/work-selection";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }

  try {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid Generation claim request." },
        { status: 400 },
      );
    }
    let selection;
    try { selection = readWorkSelection((body as Record<string, unknown>).selection); }
    catch (error) { return NextResponse.json({ success: false, message: (error as Error).message }, { status: 400 }); }
    const excludedJobIdsValue = (body as Record<string, unknown>).excludedJobIds;
    const excludedJobIds = Array.isArray(excludedJobIdsValue)
      ? excludedJobIdsValue.filter((id): id is string =>
        typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      : [];
    if (
      excludedJobIds.length !== (Array.isArray(excludedJobIdsValue) ? excludedJobIdsValue.length : 0) ||
      excludedJobIds.length > 10_000
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid Generation exclusion list." },
        { status: 400 },
      );
    }

    // Nothing is recorded on a job until its files are downloaded (server/generation/generation-hold.ts):
    // a job not completed, with no résumé and no live hold, is ready, whatever an older release wrote.
    const now = new Date();

    // Each Chrome holds up to the Manager's "Concurrent Generation" number of jobs at once (each in its
    // own ChatGPT tab). An extension that does not say it runs several (parallel: true) keeps one job
    // per Chrome, and one that sends no Chrome identity keeps the older rule of one job per Manager.
    const browser = await resolveExtensionBrowser(manager.id, request);
    if (browser && !browser.canTakeWork) {
      return NextResponse.json(
        { success: false, message: `Update the QTS extension to version ${MIN_WORK_EXTENSION_VERSION} or newer to run Generation.` },
        { status: 426 },
      );
    }
    const sameChrome = browser ? [eq(jobs.generationBrowserId, browser.id)] : [];
    const runsSeveral = Boolean(browser) && (body as Record<string, unknown>).parallel === true;
    const heldByThisChrome = () => and(eq(jobs.managerId, manager.id), generationHeld(now), ...sameChrome);

    // One read: the jobs this Chrome holds now and the Manager's number.
    const [capacity] = await db
        .select({
          held: sql<number>`(select count(*)::int from ${jobs} where ${heldByThisChrome()})`,
          configured: users.generationParallelLimit,
        })
        .from(users)
        .where(eq(users.id, manager.id))
        .limit(1);
    const parallelLimit = runsSeveral
      ? Math.min(Math.max(Number(capacity?.configured) || DEFAULT_GENERATION_PARALLEL_LIMIT, 1), MAX_GENERATION_PARALLEL_LIMIT)
      : 1;
    if ((Number(capacity?.held) || 0) >= parallelLimit) {
      return NextResponse.json({ success: true, job: null, processing: true, parallelLimit });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [candidate] = await db
          .select({
            id: jobs.id,
            jobUrl: jobs.jobUrl,
            jobTitle: jobs.jobTitle,
            company: jobs.company,
            location: jobs.location,
            employmentType: jobs.employmentType,
            workplaceType: jobs.workplaceType,
            salary: jobs.salary,
            description: effectiveJobDescription(),
            // For the extension panel's Generation card only.
            firstName: profiles.firstName,
            lastName: profiles.lastName,
          })
          .from(jobs)
          .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
          .innerJoin(users, eq(users.id, profiles.userId))
          .where(and(
            eq(jobs.managerId, manager.id),
            ne(jobs.generationStatus, "completed"),
            generationFree(now),
            isNull(jobs.resumeLocalPath),
            hasEffectiveJobDescription(),
            hasEligibleExperienceCount(),
            eq(users.parentUserId, manager.id),
            eq(users.role, "account"),
            isNull(users.blockedAt),
            // A run for chosen jobs keeps to them, but a Custom job (the launcher's pasted job) is
            // always taken too: the Manager is waiting for it.
            ...(selection ? [or(
              isNotNull(jobs.customKind),
              and(...(selection.candidateId ? [eq(jobs.candidateId, selection.candidateId)] : []), inArray(jobs.id, selection.jobIds)),
            )] : []),
            ...(excludedJobIds.length ? [notInArray(jobs.id, excludedJobIds)] : []),
          ))
          // Custom jobs first, by any Chrome (all of them save to the same PC's QTS_Resume): the one
          // made in this Chrome before others' Custom jobs, then the normal queue, oldest first.
          .orderBy(
            sql`(${jobs.customKind} is not null) desc`,
            ...(browser ? [sql`(${jobs.pinnedBrowserId} = ${browser.id}) desc nulls last`] : []),
            asc(jobs.createdAt),
            asc(jobs.id),
          )
          .limit(1);
        if (!candidate) {
          return NextResponse.json({ success: true, job: null, parallelLimit });
        }

        const [claimed] = await db
          .update(jobs)
          // Only the hold: the job's status, error and dates stay as they are.
          .set({
            generationLeaseExpiresAt: holdUntil(now),
            generationBrowserId: browser?.id ?? null,
          })
          .where(and(
            eq(jobs.id, candidate.id),
            eq(jobs.managerId, manager.id),
            ne(jobs.generationStatus, "completed"),
            generationFree(now),
            isNull(jobs.resumeLocalPath),
          ))
          .returning({ id: jobs.id });
        if (!claimed) {
          // Another claim took this job first: count again, then try the next one.
          const [heldAgain] = await db
            .select({ held: sql<number>`count(*)::int` })
            .from(jobs)
            .where(heldByThisChrome());
          if ((Number(heldAgain?.held) || 0) >= parallelLimit) {
            return NextResponse.json({ success: true, job: null, processing: true, parallelLimit });
          }
          continue;
        }
        return NextResponse.json({
          success: true,
          parallelLimit,
          job: {
            id: candidate.id,
            jobUrl: candidate.jobUrl,
            jobTitle: candidate.jobTitle,
            company: candidate.company,
            location: candidate.location ?? "",
            employmentType: candidate.employmentType ?? "",
            workplaceType: candidate.workplaceType ?? "",
            salary: candidate.salary ?? "",
            description: candidate.description ?? "",
            candidateName: [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
          },
        });
    }
    return NextResponse.json({ success: true, job: null, parallelLimit });
  } catch (error) {
    console.error("Could not claim queued Generation job.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not claim the next Generation job." },
      { status: 500 },
    );
  }
}
