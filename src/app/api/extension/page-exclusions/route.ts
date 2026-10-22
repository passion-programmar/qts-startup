import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { extensionPageExclusions } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  managerCanManagePageExclusions,
  readPageExclusionUrl,
} from "@/server/page-exclusions";
import { errorCode, isRecord } from "@/server/text-highlights";

const maxPageExclusions = 200;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse({ success: false, message: "Extension session is invalid or expired." }, 401);
  }
  try {
    return await listResponse(manager.id);
  } catch (error) {
    console.error(`Could not load Manager page exclusions (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not load excluded page URLs." }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse({ success: false, message: "Extension session is invalid or expired." }, 401);
  }
  try {
    if (!(await managerCanManagePageExclusions(manager.id))) {
      return jsonResponse({ success: false, message: "Super must assign page exclusion management to this Manager." }, 403);
    }
    const body: unknown = await request.json().catch(() => null);
    const urlRule = readPageExclusionUrl(isRecord(body) ? body.url : null);
    if (!urlRule) {
      return jsonResponse({ success: false, message: "Enter a valid website domain or http(s) URL path without query parameters." }, 400);
    }
    const existing = await db
      .select({ id: extensionPageExclusions.id })
      .from(extensionPageExclusions)
      .where(eq(extensionPageExclusions.managerId, manager.id))
      .limit(maxPageExclusions);
    if (existing.length >= maxPageExclusions) {
      return jsonResponse({ success: false, message: `A maximum of ${maxPageExclusions} excluded URLs is allowed.` }, 400);
    }
    const [created] = await db
      .insert(extensionPageExclusions)
      .values({ managerId: manager.id, urlRule })
      .onConflictDoNothing()
      .returning({ id: extensionPageExclusions.id });
    if (!created) {
      return jsonResponse({ success: false, message: "That website or path is already excluded." }, 409);
    }
    return listResponse(manager.id);
  } catch (error) {
    console.error(`Could not create Manager page exclusion (code: ${errorCode(error)}).`);
    return jsonResponse({ success: false, message: "Could not save the excluded URL." }, 500);
  }
}

async function listResponse(managerId: string): Promise<NextResponse> {
  const exclusions = await db
    .select({
      id: extensionPageExclusions.id,
      url: extensionPageExclusions.urlRule,
    })
    .from(extensionPageExclusions)
    .where(eq(extensionPageExclusions.managerId, managerId))
    .orderBy(asc(extensionPageExclusions.createdAt), asc(extensionPageExclusions.id))
    .limit(maxPageExclusions);
  const canManagePageExclusions = await managerCanManagePageExclusions(managerId);
  return jsonResponse({
    success: true,
    managerId,
    canManagePageExclusions,
    exclusions,
  });
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
