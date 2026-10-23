import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { extensionPageExclusions } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import { managerCanManagePageExclusions } from "@/server/page-exclusions";
import { normalizePageDetectionKeyword } from "@/server/page-exclusion-values";
import { errorCode, isRecord } from "@/server/text-highlights";

type RouteContext = { params: Promise<{ exclusionId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse({ success: false, message: "Extension session is invalid or expired." }, 401);
  }
  try {
    if (!(await managerCanManagePageExclusions(manager.id))) {
      return jsonResponse({ success: false, message: "Super must assign job-page keyword management to this Manager." }, 403);
    }
    const { exclusionId } = await context.params;
    if (!isUuid(exclusionId)) {
      return jsonResponse({ success: false, message: "Invalid job-page keyword ID." }, 400);
    }
    const body: unknown = await request.json().catch(() => null);
    const keyword = normalizePageDetectionKeyword(isRecord(body) ? (body.keyword ?? body.url) : null);
    if (!keyword) {
      return jsonResponse({ success: false, message: "Enter a job-page keyword between 2 and 200 characters." }, 400);
    }
    try {
      const [updated] = await db
        .update(extensionPageExclusions)
        .set({ urlRule: keyword })
        .where(and(
          eq(extensionPageExclusions.id, exclusionId),
          eq(extensionPageExclusions.managerId, manager.id),
        ))
        .returning({ id: extensionPageExclusions.id });
      if (!updated) return jsonResponse({ success: false, message: "That job-page keyword no longer exists." }, 404);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return jsonResponse({ success: false, message: "That job-page keyword already exists." }, 409);
      }
      throw error;
    }
    return listResponse(manager.id);
  } catch (error) {
    console.error(`Could not update Manager job-page keyword (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not update the job-page keyword." }, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse({ success: false, message: "Extension session is invalid or expired." }, 401);
  }
  try {
    if (!(await managerCanManagePageExclusions(manager.id))) {
      return jsonResponse({ success: false, message: "Super must assign job-page keyword management to this Manager." }, 403);
    }
    const { exclusionId } = await context.params;
    if (!isUuid(exclusionId)) {
      return jsonResponse({ success: false, message: "Invalid job-page keyword ID." }, 400);
    }
    const [deleted] = await db
      .delete(extensionPageExclusions)
      .where(and(
        eq(extensionPageExclusions.id, exclusionId),
        eq(extensionPageExclusions.managerId, manager.id),
      ))
      .returning({ id: extensionPageExclusions.id });
    if (!deleted) {
      return jsonResponse({ success: false, message: "That job-page keyword no longer exists." }, 404);
    }
    const exclusions = await db
      .select({
        id: extensionPageExclusions.id,
        url: extensionPageExclusions.urlRule,
      })
      .from(extensionPageExclusions)
      .where(eq(extensionPageExclusions.managerId, manager.id))
      .orderBy(extensionPageExclusions.createdAt, extensionPageExclusions.id)
      .limit(200);
    return jsonResponse({
      success: true,
      managerId: manager.id,
      canManagePageExclusions: true,
      exclusions,
    });
  } catch (error) {
    console.error(`Could not delete Manager job-page keyword (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not remove the job-page keyword." }, 500);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505";
}

async function listResponse(managerId: string): Promise<NextResponse> {
  const exclusions = await db
    .select({
      id: extensionPageExclusions.id,
      url: extensionPageExclusions.urlRule,
    })
    .from(extensionPageExclusions)
    .where(eq(extensionPageExclusions.managerId, managerId))
    .orderBy(extensionPageExclusions.createdAt, extensionPageExclusions.id)
    .limit(200);
  return jsonResponse({
    success: true,
    managerId,
    canManagePageExclusions: true,
    exclusions,
  });
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
