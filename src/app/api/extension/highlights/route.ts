import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import { textHighlightRules } from "@/db/schema";
import {
  errorCode,
  managerCanManageTextHighlights,
  readTextHighlightRule,
} from "@/server/text-highlights";

const maxHighlightRules = 500;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    const rules = await db
      .select({
        id: textHighlightRules.id,
        text: textHighlightRules.text,
        textColor: textHighlightRules.textColor,
        backgroundColor: textHighlightRules.backgroundColor,
      })
      .from(textHighlightRules)
      .orderBy(asc(textHighlightRules.createdAt), asc(textHighlightRules.id))
      .limit(maxHighlightRules);
    return jsonResponse({ success: true, rules });
  } catch (error) {
    console.error(`Could not load shared text highlight rules (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not load shared text highlight rules." }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  try {
    if (!(await managerCanManageTextHighlights(manager.id))) {
      return jsonResponse({ success: false, message: "Super must assign text highlight management to this Manager." }, 403);
    }
    const body: unknown = await request.json().catch(() => null);
    const rule = readTextHighlightRule(body);
    if (!rule) return jsonResponse({ success: false, message: "Enter a phrase and valid text and background colors." }, 400);
    const [created] = await db
      .insert(textHighlightRules)
      .values({ ...rule, createdByUserId: manager.id })
      .onConflictDoNothing()
      .returning({
        id: textHighlightRules.id,
        text: textHighlightRules.text,
        textColor: textHighlightRules.textColor,
        backgroundColor: textHighlightRules.backgroundColor,
      });
    if (!created) return jsonResponse({ success: false, message: "A highlight rule for that phrase already exists." }, 409);
    return listResponse();
  } catch (error) {
    console.error(`Could not create shared text highlight rule (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not save the shared highlight rule." }, 500);
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
    .limit(maxHighlightRules);
  return jsonResponse({ success: true, rules });
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
