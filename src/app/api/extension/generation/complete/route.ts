import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";

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
  const completed = Boolean(responseText);
  if (!uuidPattern.test(generationId) || !jobDescription || (!completed && !failureReason)) {
    return NextResponse.json(
      { success: false, message: "A valid Generation ID, JD, and response or failure reason are required." },
      { status: 400 },
    );
  }
  if (responseJson && (!isRecord(responseJson.resume) || !isRecord(responseJson.coverLetter))) {
    return NextResponse.json(
      { success: false, message: "Parsed JSON must contain resume and coverLetter objects." },
      { status: 400 },
    );
  }

  try {
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
      .returning({ id: generationRuns.id });
    if (!updated) {
      return NextResponse.json(
        { success: false, message: "This Generation run was not found or was already completed." },
        { status: 404 },
      );
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
