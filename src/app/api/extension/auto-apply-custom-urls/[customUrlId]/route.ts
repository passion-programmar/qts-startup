import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { autoApplyCustomUrls } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { managerCanManageJobDetectionUrlRules } from "@/server/job-detection-url-rules";
import { errorCode } from "@/server/text-highlights";

type RouteContext = { params: Promise<{ customUrlId: string }> };

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageJobDetectionUrlRules(manager.id))) {
      return jsonResponse({ success: false, message: "Ask your Super Admin for Custom URLs access." }, 403);
    }
    const { customUrlId } = await context.params;
    if (!isUuid(customUrlId)) return jsonResponse({ success: false, message: "Invalid Custom URL ID." }, 400);
    const [deleted] = await db.delete(autoApplyCustomUrls).where(and(
      eq(autoApplyCustomUrls.id, customUrlId),
      eq(autoApplyCustomUrls.managerId, manager.id),
    )).returning({ id: autoApplyCustomUrls.id });
    if (!deleted) return jsonResponse({ success: false, message: "That Custom URL no longer exists." }, 404);
    const customUrls = await db
      .select({ id: autoApplyCustomUrls.id, url: autoApplyCustomUrls.urlPrefix })
      .from(autoApplyCustomUrls)
      .where(eq(autoApplyCustomUrls.managerId, manager.id))
      .limit(200);
    return jsonResponse({ success: true, managerId: manager.id, customUrls });
  } catch (error) {
    console.error(`Could not delete Manager Auto Apply custom URL (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not delete this Custom URL." }, 500);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
