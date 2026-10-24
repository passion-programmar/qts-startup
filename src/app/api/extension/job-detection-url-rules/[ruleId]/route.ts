import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { extensionJobDetectionUrlRules } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  isUniqueJobDetectionUrlRuleViolation,
  managerCanManageJobDetectionUrlRules,
  normalizeJobDetectionUrlRule,
} from "@/server/job-detection-url-rules";
import { errorCode, isRecord } from "@/server/text-highlights";

type RouteContext = { params: Promise<{ ruleId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageJobDetectionUrlRules(manager.id))) {
      return jsonResponse({ success: false, message: "Ask your Super Admin for access to manage blocked URLs." }, 403);
    }
    const { ruleId } = await context.params;
    if (!isUuid(ruleId)) return jsonResponse({ success: false, message: "Invalid job-detection URL rule ID." }, 400);
    const body: unknown = await request.json().catch(() => null);
    const urlRule = normalizeJobDetectionUrlRule(isRecord(body) ? body.url : null);
    if (!urlRule) {
      return jsonResponse({ success: false, message: "Enter a URL fragment to block." }, 400);
    }
    try {
      const [updated] = await db
        .update(extensionJobDetectionUrlRules)
        .set({ urlRule, updatedAt: new Date() })
        .where(and(
          eq(extensionJobDetectionUrlRules.id, ruleId),
          eq(extensionJobDetectionUrlRules.managerId, manager.id),
        ))
        .returning({ id: extensionJobDetectionUrlRules.id });
      if (!updated) return jsonResponse({ success: false, message: "That job-detection URL rule no longer exists." }, 404);
    } catch (error) {
      if (isUniqueJobDetectionUrlRuleViolation(error)) {
        return jsonResponse({ success: false, message: "That job-detection URL rule already exists." }, 409);
      }
      throw error;
    }
    return listResponse(manager.id);
  } catch (error) {
    console.error(`Could not update Manager job-detection URL rule (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not update the job-detection URL rule." }, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageJobDetectionUrlRules(manager.id))) {
      return jsonResponse({ success: false, message: "Ask your Super Admin for access to manage blocked URLs." }, 403);
    }
    const { ruleId } = await context.params;
    if (!isUuid(ruleId)) return jsonResponse({ success: false, message: "Invalid job-detection URL rule ID." }, 400);
    const [deleted] = await db
      .delete(extensionJobDetectionUrlRules)
      .where(and(
        eq(extensionJobDetectionUrlRules.id, ruleId),
        eq(extensionJobDetectionUrlRules.managerId, manager.id),
      ))
      .returning({ id: extensionJobDetectionUrlRules.id });
    if (!deleted) return jsonResponse({ success: false, message: "That job-detection URL rule no longer exists." }, 404);
    return listResponse(manager.id);
  } catch (error) {
    console.error(`Could not delete Manager job-detection URL rule (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not delete the job-detection URL rule." }, 500);
  }
}

async function listResponse(managerId: string): Promise<NextResponse> {
  const [rules, canManageJobDetectionUrlRules] = await Promise.all([
    db
      .select({
        id: extensionJobDetectionUrlRules.id,
        url: extensionJobDetectionUrlRules.urlRule,
      })
      .from(extensionJobDetectionUrlRules)
      .where(eq(extensionJobDetectionUrlRules.managerId, managerId))
      .orderBy(extensionJobDetectionUrlRules.createdAt, extensionJobDetectionUrlRules.id)
      .limit(200),
    managerCanManageJobDetectionUrlRules(managerId),
  ]);
  return jsonResponse({ success: true, managerId, canManageJobDetectionUrlRules, rules });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
