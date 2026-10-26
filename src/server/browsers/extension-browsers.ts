import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { extensionBrowsers, users } from "@/db/schema";
import { db } from "@/lib/db";
import { type BrowserHeaders, canTakeWork, defaultBrowserName, parseBrowserHeaders } from "@/server/apply/apply-values";

export type ExtensionBrowser = {
  id: string;
  name: string;
  extensionVersion: string | null;
  canTakeWork: boolean;
};

/**
 * The Chrome a request came from, registered on first sight. Null when the extension sends no
 * Chrome identity (versions before multi-Chrome work), which may still use Get JD.
 */
export async function resolveExtensionBrowser(
  managerId: string,
  request: Request,
): Promise<ExtensionBrowser | null> {
  const identity = parseBrowserHeaders(request.headers);
  if (!identity) return null;
  return upsertExtensionBrowser(managerId, identity);
}

async function upsertExtensionBrowser(managerId: string, identity: BrowserHeaders): Promise<ExtensionBrowser> {
  const now = new Date();
  const [row] = await db
    .insert(extensionBrowsers)
    .values({
      managerId,
      browserKey: identity.browserKey,
      name: identity.browserName ?? defaultBrowserName(identity.browserKey),
      extensionVersion: identity.extensionVersion,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [extensionBrowsers.managerId, extensionBrowsers.browserKey],
      set: {
        extensionVersion: identity.extensionVersion,
        lastSeenAt: now,
        updatedAt: now,
        // A name the Manager gave this Chrome in the extension wins over the automatic one.
        ...(identity.browserName ? { name: identity.browserName } : {}),
      },
    })
    .returning({
      id: extensionBrowsers.id,
      name: extensionBrowsers.name,
      extensionVersion: extensionBrowsers.extensionVersion,
    });
  return { ...row, canTakeWork: canTakeWork(row.extensionVersion) };
}

export type BrowserModes = { getJdOn: boolean; workMode: "off" | "generation" | "apply" };

/** Records which modes a Chrome runs and returns the Manager's Stop-all counters. */
export async function recordBrowserHeartbeat(
  managerId: string,
  browser: ExtensionBrowser,
  modes: BrowserModes,
): Promise<{ generationStopVersion: number; applyStopVersion: number }> {
  const now = new Date();
  const [, [manager]] = await db.batch([
    db
      .update(extensionBrowsers)
      .set({ getJdOn: modes.getJdOn, workMode: modes.workMode, lastSeenAt: now, updatedAt: now })
      .where(and(eq(extensionBrowsers.id, browser.id), eq(extensionBrowsers.managerId, managerId))),
    db
      .select({
        generationStopVersion: users.generationStopVersion,
        applyStopVersion: users.applyStopVersion,
      })
      .from(users)
      .where(eq(users.id, managerId))
      .limit(1),
  ]);
  return {
    generationStopVersion: manager?.generationStopVersion ?? 0,
    applyStopVersion: manager?.applyStopVersion ?? 0,
  };
}

/** "Stop all" from the Jobs page: every Chrome of this Manager stops the mode on its next heartbeat. */
export async function requestStopAll(managerId: string, mode: "generation" | "apply"): Promise<void> {
  await db
    .update(users)
    .set(mode === "generation"
      ? { generationStopVersion: sql`${users.generationStopVersion} + 1`, updatedAt: new Date() }
      : { applyStopVersion: sql`${users.applyStopVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, managerId));
}
