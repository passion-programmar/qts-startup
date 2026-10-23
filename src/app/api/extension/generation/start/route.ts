import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { educations, experiences, generationRuns, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readGenerationJob } from "@/server/generation/generation-values";
import {
  composeGenerationPrompt,
  getManagerDocumentPrompt,
  MissingDocumentPromptError,
} from "@/server/generation/manager-prompt";
import { normalizeJobUrl } from "@/server/jobs/job-values";

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
  const job = readGenerationJob(body);
  if (!job) {
    return NextResponse.json(
      { success: false, message: "A URL, title, company, and job description are required." },
      { status: 400 },
    );
  }

  try {
    const jobIdValue = isRecord(body) ? body.jobId : undefined;
    const jobId = typeof jobIdValue === "string" ? jobIdValue : null;
    if (jobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ success: false, message: "Invalid queued job ID." }, { status: 400 });
    }

    let candidateProfile: unknown = {};
    let normalizedJob = { ...job, jobUrl: normalizeJobUrl(job.jobUrl) };
    if (jobId) {
      const [savedJob] = await db
        .select({
          jobUrl: jobs.jobUrl,
          jobTitle: jobs.jobTitle,
          company: jobs.company,
          location: jobs.location,
          employmentType: jobs.employmentType,
          workplaceType: jobs.workplaceType,
          salary: jobs.salary,
          description: jobs.description,
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
          { success: false, message: "The claimed job is no longer available to this manager." },
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
      candidateProfile = {
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
        jdMatching: savedJob.jdMatching,
        education,
        experience,
      };
      normalizedJob = {
        ...job,
        jobUrl: normalizeJobUrl(savedJob.jobUrl),
        jobTitle: savedJob.jobTitle,
        company: savedJob.company,
        location: savedJob.location || job.location,
        employmentType: job.employmentType || savedJob.employmentType || "",
        workplaceType: job.workplaceType || savedJob.workplaceType || "",
        salary: job.salary || savedJob.salary || "",
        jobDescription: job.jobDescription || savedJob.description || "",
      };
      if (!normalizedJob.jobDescription) {
        return NextResponse.json(
          { success: false, message: "The job page did not provide a job description." },
          { status: 422 },
        );
      }
    }
    const promptTemplate = await getManagerDocumentPrompt(manager.id);
    const composedPrompt = composeGenerationPrompt(promptTemplate, normalizedJob, candidateProfile);
    if (jobId) {
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
    }
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
        { success: false, message: "No saved resume and cover-letter prompt is available. Ask your Super Admin to configure one." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { success: false, message: "QTS could not start Generation. Try again." },
      { status: 500 },
    );
  }
}
