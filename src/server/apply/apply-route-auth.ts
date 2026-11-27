import "server-only";

import { NextResponse } from "next/server";
import { type ExtensionApplySettings, type ExtensionManager, getExtensionManagerWithApplyAccess } from "@/lib/extension-auth";
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
): Promise<{ manager: ExtensionManager; browser: ExtensionBrowser; applySettings: ExtensionApplySettings } | NextResponse> {
  // Apply access and the Manager's Apply settings come with the session check, in the same database
  // read (2026-11-27: the heartbeat and claim routes read the same row again afterwards).
  const signedIn = await getExtensionManagerWithApplyAccess(request);
  if (!signedIn) return refuse(401, "Your QTS session has ended. Sign in again.");
  const { manager, canUseApply, applySettings } = signedIn;
  const browser = await resolveExtensionBrowser(manager.id, request);
  if (!browser) return refuse(400, "This extension did not identify its Chrome. Update the QTS extension.");
  if (!browser.canTakeWork) {
    return refuse(426, `Update the QTS extension to version ${MIN_WORK_EXTENSION_VERSION} or newer to apply.`);
  }
  if (!canUseApply) return refuse(403, "Apply is not turned on for your account. Ask your Super Admin.");
  return { manager, browser, applySettings };
}
