import { and, asc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { MIN_WORK_EXTENSION_VERSION } from "@/server/apply/apply-values";
import { resolveExtensionBrowser } from "@/server/browsers/extension-browsers";
import { generationFree, generationHeld, holdUntil } from "@/server/generation/generation-hold";
import { effectiveJobDescription, hasEffectiveJobDescription } from "@/server/jobs/job-description";

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

    // Each Chrome processes one job at a time; an extension that sends no Chrome identity keeps the
    // older rule of one job per Manager.
    const browser = await resolveExtensionBrowser(manager.id, request);
    if (browser && !browser.canTakeWork) {
      return NextResponse.json(
        { success: false, message: `Update the QTS extension to version ${MIN_WORK_EXTENSION_VERSION} or newer to run Generation.` },
        { status: 426 },
      );
    }
    const sameChrome = browser ? [eq(jobs.generationBrowserId, browser.id)] : [];

    const [activeJob] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(
          eq(jobs.managerId, manager.id),
          generationHeld(now),
          ...sameChrome,
        ))
        .limit(1);
    if (activeJob) {
      return NextResponse.json({ success: true, job: null, processing: true });
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
            sql`length(btrim(${profiles.jdMatching})) > 0`,
            eq(users.parentUserId, manager.id),
            eq(users.role, "account"),
            isNull(users.blockedAt),
            ...(excludedJobIds.length ? [notInArray(jobs.id, excludedJobIds)] : []),
          ))
          .orderBy(asc(jobs.createdAt), asc(jobs.id))
          .limit(1);
        if (!candidate) {
          return NextResponse.json({ success: true, job: null });
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
          const [anotherActiveJob] = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(
              eq(jobs.managerId, manager.id),
              generationHeld(now),
              ...sameChrome,
            ))
            .limit(1);
          if (anotherActiveJob) {
            return NextResponse.json({ success: true, job: null, processing: true });
          }
          continue;
        }
        return NextResponse.json({
          success: true,
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
          },
        });
    }
    return NextResponse.json({ success: true, job: null });
  } catch (error) {
    console.error("Could not claim queued Generation job.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not claim the next Generation job." },
      { status: 500 },
    );
  }
}
