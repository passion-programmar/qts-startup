import { NextResponse } from "next/server";
import { generationRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { readGenerationJob } from "@/server/generation/generation-values";
import {
  composeGenerationPrompt,
  getManagerDocumentPrompt,
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
    const normalizedJob = { ...job, jobUrl: normalizeJobUrl(job.jobUrl) };
    const promptTemplate = await getManagerDocumentPrompt(manager.id);
    const composedPrompt = composeGenerationPrompt(promptTemplate, normalizedJob);
    const [run] = await db
      .insert(generationRuns)
      .values({
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
    return NextResponse.json(
      { success: false, message: "QTS could not start Generation. Try again." },
      { status: 500 },
    );
  }
}
