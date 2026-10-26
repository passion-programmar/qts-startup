import "server-only";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { type ExtensionManager, getExtensionManager } from "@/lib/extension-auth";
import { type ExtensionBrowser, resolveExtensionBrowser } from "@/server/browsers/extension-browsers";
import { MIN_WORK_EXTENSION_VERSION } from "./apply-values";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function refuse(status: number, message: string): NextResponse {
  return NextResponse.json({ success: false, message }, { status });
}

/**
 * Every Apply route: a signed-in Manager whom Super Admin allowed to use Apply, from a Chrome
 * that identified itself and runs a current extension version. Otherwise the refusal to return.
 */
export async function authorizeApplyRequest(
  request: Request,
): Promise<{ manager: ExtensionManager; browser: ExtensionBrowser } | NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return refuse(401, "Your QTS session has ended. Sign in again.");
  const browser = await resolveExtensionBrowser(manager.id, request);
  if (!browser) return refuse(400, "This extension did not identify its Chrome. Update the QTS extension.");
  if (!browser.canTakeWork) {
    return refuse(426, `Update the QTS extension to version ${MIN_WORK_EXTENSION_VERSION} or newer to apply.`);
  }
  const [settings] = await db
    .select({ canUseApply: users.canUseApply })
    .from(users)
    .where(eq(users.id, manager.id))
    .limit(1);
  if (!settings?.canUseApply) return refuse(403, "Apply is not turned on for your account. Ask your Super Admin.");
  return { manager, browser };
}
