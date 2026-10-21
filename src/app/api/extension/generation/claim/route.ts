import { and, asc, eq, isNull, isNotNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";

const leaseDurationMs = 20 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
      { status: 401 },
    );
  }

  try {
    await db
      .update(jobs)
      .set({
        generationStatus: "queued",
        generationLeaseExpiresAt: null,
        generationError: "The previous worker stopped before Generation completed. Queued for retry.",
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobs.managerId, manager.id),
        eq(jobs.generationStatus, "processing"),
        isNotNull(jobs.generationLeaseExpiresAt),
        lte(jobs.generationLeaseExpiresAt, new Date()),
      ));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [candidate] = await db
        .select({
          id: jobs.id,
          jobUrl: jobs.jobUrl,
          jobTitle: jobs.jobTitle,
          company: jobs.company,
          location: jobs.location,
          description: jobs.description,
        })
        .from(jobs)
        .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
        .innerJoin(users, eq(users.id, profiles.userId))
        .where(and(
          eq(jobs.managerId, manager.id),
          eq(jobs.generationStatus, "queued"),
          eq(users.parentUserId, manager.id),
          eq(users.role, "account"),
          isNull(users.blockedAt),
        ))
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
        .limit(1);
      if (!candidate) {
        return NextResponse.json({ success: true, job: null });
      }

      const now = new Date();
      const [claimed] = await db
        .update(jobs)
        .set({
          generationStatus: "processing",
          generationError: null,
          generationLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
          updatedAt: now,
        })
        .where(and(
          eq(jobs.id, candidate.id),
          eq(jobs.managerId, manager.id),
          eq(jobs.generationStatus, "queued"),
        ))
        .returning({ id: jobs.id });
      if (!claimed) continue;
      return NextResponse.json({
        success: true,
        job: {
          id: candidate.id,
          jobUrl: candidate.jobUrl,
          jobTitle: candidate.jobTitle,
          company: candidate.company,
          location: candidate.location ?? "",
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
