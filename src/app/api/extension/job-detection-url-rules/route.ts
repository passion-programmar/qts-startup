import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { extensionJobDetectionUrlRules } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import {
  managerCanManageJobDetectionUrlRules,
  normalizeJobDetectionUrlRule,
} from "@/server/job-detection-url-rules";
import { errorCode, isRecord } from "@/server/text-highlights";

const maxRules = 200;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    return await listResponse(manager.id);
  } catch (error) {
    console.error(`Could not load Manager blocked URL rules (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not load blocked URL rules." }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageJobDetectionUrlRules(manager.id))) {
      return jsonResponse({ success: false, message: "Ask your Super Admin for access to manage blocked URLs." }, 403);
    }
    const body: unknown = await request.json().catch(() => null);
    const urlRule = normalizeJobDetectionUrlRule(isRecord(body) ? body.url : null);
    if (!urlRule) {
      return jsonResponse({ success: false, message: "Enter a URL fragment to block." }, 400);
    }
    const existing = await db
      .select({ id: extensionJobDetectionUrlRules.id })
      .from(extensionJobDetectionUrlRules)
      .where(eq(extensionJobDetectionUrlRules.managerId, manager.id))
      .limit(maxRules);
    if (existing.length >= maxRules) {
      return jsonResponse({ success: false, message: `A maximum of ${maxRules} blocked URL rules is allowed.` }, 400);
    }
    const [created] = await db
      .insert(extensionJobDetectionUrlRules)
      .values({ managerId: manager.id, urlRule })
      .onConflictDoNothing()
      .returning({ id: extensionJobDetectionUrlRules.id });
    if (!created) return jsonResponse({ success: false, message: "That blocked URL fragment already exists." }, 409);
    return listResponse(manager.id);
  } catch (error) {
    console.error(`Could not create Manager blocked URL rule (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not save the blocked URL rule." }, 500);
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
      .orderBy(asc(extensionJobDetectionUrlRules.createdAt), asc(extensionJobDetectionUrlRules.id))
      .limit(maxRules),
    managerCanManageJobDetectionUrlRules(managerId),
  ]);
  return jsonResponse({ success: true, managerId, canManageJobDetectionUrlRules, rules });
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
