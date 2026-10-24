import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { textHighlightRules } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  errorCode,
  managerCanManageTextHighlights,
  readTextHighlightRule,
} from "@/server/text-highlights";

type RouteContext = { params: Promise<{ ruleId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageTextHighlights(manager.id))) {
      return jsonResponse({ success: false, message: "Super must assign text highlight management to this Manager." }, 403);
    }
    const { ruleId } = await context.params;
    if (!isUuid(ruleId)) return jsonResponse({ success: false, message: "Invalid highlight rule ID." }, 400);
    const body: unknown = await request.json().catch(() => null);
    const rule = readTextHighlightRule(body);
    if (!rule) return jsonResponse({ success: false, message: "Enter a phrase and valid text and background colors." }, 400);
    const [updated] = await db
      .update(textHighlightRules)
      .set({ ...rule, updatedAt: new Date() })
      .where(eq(textHighlightRules.id, ruleId))
      .returning({ id: textHighlightRules.id });
    if (!updated) return jsonResponse({ success: false, message: "That highlight rule no longer exists." }, 404);
    return listResponse();
  } catch (error) {
    console.error(`Could not update shared text highlight rule (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not update the shared highlight rule." }, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageTextHighlights(manager.id))) {
      return jsonResponse({ success: false, message: "Super must assign text highlight management to this Manager." }, 403);
    }
    const { ruleId } = await context.params;
    if (!isUuid(ruleId)) return jsonResponse({ success: false, message: "Invalid highlight rule ID." }, 400);
    const [deleted] = await db
      .delete(textHighlightRules)
      .where(eq(textHighlightRules.id, ruleId))
      .returning({ id: textHighlightRules.id });
    if (!deleted) return jsonResponse({ success: false, message: "That highlight rule no longer exists." }, 404);
    return listResponse();
  } catch (error) {
    console.error(`Could not delete shared text highlight rule (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not delete the shared highlight rule." }, 500);
  }
}

async function listResponse(): Promise<NextResponse> {
  const rules = await db
    .select({
      id: textHighlightRules.id,
      text: textHighlightRules.text,
      textColor: textHighlightRules.textColor,
      backgroundColor: textHighlightRules.backgroundColor,
    })
    .from(textHighlightRules)
    .orderBy(asc(textHighlightRules.createdAt), asc(textHighlightRules.id))
    .limit(500);
  return jsonResponse({ success: true, rules });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
