import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationRuns, jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";
import { parsePdfPackage } from "@/app/pdf/document-data";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxResponseLength = 1_000_000;

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (!isRecord(body)) {
    return NextResponse.json({ success: false, message: "Generation result is required." }, { status: 400 });
  }
  const generationId = readText(body.generationId, 36);
  const jobDescription = readText(body.jobDescription, 100_000);
  const responseText = readText(body.responseText, maxResponseLength);
  const failureReason = readText(body.failureReason, 2000);
  const responseJson = isRecord(body.responseJson) ? body.responseJson : null;
  let validPackage = false;
  let parsedPackage: ReturnType<typeof parsePdfPackage> | null = null;
  if (responseJson) {
    try {
      parsedPackage = parsePdfPackage(JSON.stringify(responseJson));
      validPackage = true;
    } catch {
      validPackage = false;
    }
  }
  const completed = Boolean(responseText && validPackage);
  if (
    !uuidPattern.test(generationId)
    || !jobDescription
    || (completed && !validPackage)
    || (!completed && !failureReason)
  ) {
    return NextResponse.json(
      { success: false, message: "A valid Generation ID, JD, and a valid document package or failure reason are required." },
      { status: 400 },
    );
  }

  try {
    if (completed) {
      const [run] = await db
        .select({ jobId: generationRuns.jobId })
        .from(generationRuns)
        .where(and(
          eq(generationRuns.id, generationId),
          eq(generationRuns.managerId, manager.id),
          eq(generationRuns.status, "pending"),
        ))
        .limit(1);
      if (!run) {
        return NextResponse.json(
          { success: false, message: "This Generation run was not found or was already completed." },
          { status: 404 },
        );
      }
      if (run.jobId && parsedPackage) {
        const [candidate] = await db
          .select({
            firstName: profiles.firstName,
            lastName: profiles.lastName,
            email: profiles.candidateEmail,
          })
          .from(jobs)
          .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
          .where(and(
            eq(jobs.id, run.jobId),
            eq(jobs.managerId, manager.id),
          ))
          .limit(1);
        const expectedName = [candidate?.firstName, candidate?.lastName]
          .filter(Boolean)
          .join(" ");
        if (
          !candidate
          || normalizeIdentity(expectedName) !== normalizeIdentity(parsedPackage.resume.candidate.fullName)
          || normalizeIdentity(candidate.email ?? "") !== normalizeIdentity(parsedPackage.resume.candidate.email)
        ) {
          return NextResponse.json(
            { success: false, message: "The generated documents must use the candidate's saved name and email." },
            { status: 422 },
          );
        }
      }
    }
    const [updated] = await db
      .update(generationRuns)
      .set({
        jobDescription,
        responseText: completed ? responseText : null,
        responseJson: completed ? responseJson : null,
        status: completed ? "completed" : "failed",
        failureReason: completed ? null : failureReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(generationRuns.id, generationId),
        eq(generationRuns.managerId, manager.id),
        eq(generationRuns.status, "pending"),
      ))
      .returning({ id: generationRuns.id, jobId: generationRuns.jobId });
    if (!updated) {
      return NextResponse.json(
        { success: false, message: "This Generation run was not found or was already completed." },
        { status: 404 },
      );
    }
    if (updated.jobId && !completed) {
      await db
        .update(jobs)
        .set({
          generationStatus: "failed",
          generationError: failureReason,
          generationLeaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(jobs.id, updated.jobId),
          eq(jobs.managerId, manager.id),
          eq(jobs.generationStatus, "processing"),
        ));
    }
    return NextResponse.json({
      success: true,
      generationId: updated.id,
      status: completed ? "completed" : "failed",
      parsed: Boolean(responseJson),
    });
  } catch (error) {
    console.error("Could not save extension generation result.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not save the Generation result. Try again." },
      { status: 500 },
    );
  }
}

function normalizeIdentity(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en")
    : "";
}
