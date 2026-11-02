import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { autoApplyCustomUrls } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { managerCanManageJobDetectionUrlRules } from "@/server/job-detection-url-rules";
import { normalizeAutoApplyCustomUrl } from "@/server/auto-apply-custom-url-values";
import { errorCode, isRecord } from "@/server/text-highlights";

const maxUrls = 200;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageJobDetectionUrlRules(manager.id))) {
      return jsonResponse({ success: false, message: "Ask your Super Admin for Custom URLs access." }, 403);
    }
    return await listResponse(manager.id);
  } catch (error) {
    console.error(`Could not load Manager Auto Apply custom URLs (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not load Custom URLs." }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageJobDetectionUrlRules(manager.id))) {
      return jsonResponse({ success: false, message: "Ask your Super Admin for Custom URLs access." }, 403);
    }
    const body: unknown = await request.json().catch(() => null);
    const urlPrefix = normalizeAutoApplyCustomUrl(isRecord(body) ? body.url : null);
    if (!urlPrefix) {
      return jsonResponse({ success: false, message: "Enter a domain such as djni.co, without a path or port." }, 400);
    }
    const existing = await db
      .select({ id: autoApplyCustomUrls.id })
      .from(autoApplyCustomUrls)
      .where(eq(autoApplyCustomUrls.managerId, manager.id))
      .limit(maxUrls);
    if (existing.length >= maxUrls) {
      return jsonResponse({ success: false, message: `A maximum of ${maxUrls} Custom URLs is allowed.` }, 400);
    }
    const [created] = await db
      .insert(autoApplyCustomUrls)
      .values({ managerId: manager.id, urlPrefix })
      .onConflictDoNothing()
      .returning({ id: autoApplyCustomUrls.id });
    if (!created) return jsonResponse({ success: false, message: "That Custom URL already exists." }, 409);
    return listResponse(manager.id);
  } catch (error) {
    console.error(`Could not save Manager Auto Apply custom URL (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not save this Custom URL." }, 500);
  }
}

async function listResponse(managerId: string): Promise<NextResponse> {
  const customUrls = await db
    .select({ id: autoApplyCustomUrls.id, url: autoApplyCustomUrls.urlPrefix })
    .from(autoApplyCustomUrls)
    .where(eq(autoApplyCustomUrls.managerId, managerId))
    .orderBy(asc(autoApplyCustomUrls.createdAt), asc(autoApplyCustomUrls.id))
    .limit(maxUrls);
  return jsonResponse({ success: true, managerId, customUrls });
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
