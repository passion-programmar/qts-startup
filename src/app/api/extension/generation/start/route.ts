import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { educations, experiences, generationRuns, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";
import {
  composeGenerationPrompt,
  getManagerGenerationSetup,
  MissingDocumentPromptError,
} from "@/server/generation/manager-prompt";
import { normalizeJobUrl } from "@/server/jobs/job-values";
import { effectiveJobDescription } from "@/server/jobs/job-description";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
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
    return NextResponse.json(
      { success: false, message: "A claimed job ID is required." },
      { status: 400 },
    );
  }

  try {
    const jobId = readText(body.jobId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ success: false, message: "Invalid claimed job ID." }, { status: 400 });
    }

    const [savedJob] = await db
      .select({
          jobUrl: jobs.jobUrl,
          jobTitle: jobs.jobTitle,
          company: jobs.company,
          location: jobs.location,
          employmentType: jobs.employmentType,
          workplaceType: jobs.workplaceType,
          salary: jobs.salary,
          description: effectiveJobDescription(),
          resumeLocalPath: jobs.resumeLocalPath,
          candidateId: profiles.userId,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          email: profiles.candidateEmail,
          phone: profiles.phone,
          headline: profiles.headline,
          linkedinUrl: profiles.linkedinUrl,
          country: profiles.country,
          city: profiles.city,
          province: profiles.province,
          addressLine1: profiles.addressLine1,
          postalCode: profiles.postalCode,
          jdMatching: profiles.jdMatching,
        })
        .from(jobs)
        .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
        .innerJoin(users, eq(users.id, profiles.userId))
        .where(and(
          eq(jobs.id, jobId),
          eq(jobs.managerId, manager.id),
          eq(jobs.generationStatus, "processing"),
          eq(users.parentUserId, manager.id),
          eq(users.role, "account"),
          isNull(users.blockedAt),
        ))
        .limit(1);
    if (!savedJob) {
      return NextResponse.json(
        { success: false, message: "This job is no longer available for Generation. Refresh the Jobs page." },
        { status: 409 },
      );
    }
    if (
      !savedJob.description?.trim() ||
      !savedJob.jdMatching?.trim() ||
      savedJob.resumeLocalPath !== null
    ) {
      return NextResponse.json(
        { success: false, message: "The claimed job no longer meets Generation eligibility requirements." },
        { status: 409 },
      );
    }
    const [education, experience] = await Promise.all([
        db.select({
          institution: educations.institution,
          degree: educations.degree,
          fieldOfStudy: educations.fieldOfStudy,
          startDate: educations.startDate,
          endDate: educations.endDate,
          isCurrent: educations.isCurrent,
          description: educations.description,
        }).from(educations)
          .where(eq(educations.profileUserId, savedJob.candidateId))
          .orderBy(
            desc(educations.isCurrent),
            sql`coalesce(${educations.endDate}, ${educations.startDate}) desc nulls last`,
            sql`${educations.startDate} desc nulls last`,
            asc(educations.sortOrder),
          ),
        db.select({
          companyName: experiences.companyName,
          jobTitle: experiences.jobTitle,
          location: experiences.location,
          workMode: experiences.workMode,
          startDate: experiences.startDate,
          endDate: experiences.endDate,
          isCurrent: experiences.isCurrent,
          description: experiences.description,
        }).from(experiences)
          .where(eq(experiences.profileUserId, savedJob.candidateId))
          .orderBy(
            desc(experiences.isCurrent),
            sql`coalesce(${experiences.endDate}, ${experiences.startDate}) desc nulls last`,
            sql`${experiences.startDate} desc nulls last`,
            asc(experiences.sortOrder),
          ),
      ]);
    const fullName = [savedJob.firstName, savedJob.lastName].filter(Boolean).join(" ");
    if (!fullName || !savedJob.email) {
      return NextResponse.json(
        { success: false, message: "Complete the candidate name and email before starting Generation." },
        { status: 409 },
      );
    }
    const candidateProfile = {
      fullName,
      email: savedJob.email,
      phone: savedJob.phone,
      headline: savedJob.headline,
      linkedinUrl: savedJob.linkedinUrl,
      location: [
        savedJob.addressLine1,
        savedJob.city,
        savedJob.province,
        savedJob.country,
        savedJob.postalCode,
      ].filter(Boolean).join(", "),
      // JD matching notes stay out: they pick jobs for Get JD, not what the resume says.
      education,
      experience,
    };
    const normalizedJob = {
      jobUrl: normalizeJobUrl(savedJob.jobUrl),
      jobTitle: savedJob.jobTitle,
      company: savedJob.company,
      location: savedJob.location || "",
      employmentType: savedJob.employmentType || "",
      workplaceType: savedJob.workplaceType || "",
      salary: savedJob.salary || "",
      jobDescription: savedJob.description,
    };
    // The rotation is read from past runs, so it moves on only when the run below is saved.
    const { promptTemplate, pdfTemplate, promptId } = await getManagerGenerationSetup(manager.id);
    const composedPrompt = composeGenerationPrompt(promptTemplate, normalizedJob, candidateProfile);
    await db
      .update(generationRuns)
      .set({
        status: "failed",
        failureReason: "Superseded by a new Generation attempt.",
        updatedAt: new Date(),
      })
      .where(and(
        eq(generationRuns.jobId, jobId),
        eq(generationRuns.managerId, manager.id),
        inArray(generationRuns.status, ["pending", "completed"]),
      ));
    const [run] = await db
      .insert(generationRuns)
      .values({
        jobId,
        managerId: manager.id,
        jobUrl: normalizedJob.jobUrl,
        jobTitle: normalizedJob.jobTitle,
        company: normalizedJob.company,
        location: normalizedJob.location || null,
        jobDescription: normalizedJob.jobDescription,
        promptTemplate,
        composedPrompt,
        pdfTemplate,
        promptId,
      })
      .returning({ id: generationRuns.id });
    return NextResponse.json({
      success: true,
      generationId: run.id,
      prompt: composedPrompt,
    });
  } catch (error) {
    console.error("Could not start extension generation.", error);
    if (error instanceof MissingDocumentPromptError) {
      return NextResponse.json(
        {
          success: false,
          errorCode: "generation_prompt_missing",
          message: error.message,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, message: "QTS could not start Generation. Try again." },
      { status: 500 },
    );
  }
}
