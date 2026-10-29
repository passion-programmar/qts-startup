import "server-only";

import { eq, sql } from "drizzle-orm";
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
  const [row] = await upsertExtensionBrowser(managerId, identity, new Date());
  return { ...row, canTakeWork: canTakeWork(row.extensionVersion) };
}

export type BrowserModes = { getJdOn: boolean; workMode: "off" | "generation" | "apply" };

// Registers the Chrome on first sight and records that it was seen, with its modes when given.
function upsertExtensionBrowser(managerId: string, identity: BrowserHeaders, now: Date, modes?: BrowserModes) {
  return db
    .insert(extensionBrowsers)
    .values({
      managerId,
      browserKey: identity.browserKey,
      name: identity.browserName ?? defaultBrowserName(identity.browserKey),
      extensionVersion: identity.extensionVersion,
      ...modes,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [extensionBrowsers.managerId, extensionBrowsers.browserKey],
      set: {
        extensionVersion: identity.extensionVersion,
        ...modes,
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
}

/**
 * A Chrome's heartbeat in one database round trip: registers it as resolveExtensionBrowser does,
 * records which modes it runs, and returns the Manager's Stop-all counters.
 */
export async function recordBrowserHeartbeat(
  managerId: string,
  identity: BrowserHeaders,
  modes: BrowserModes,
): Promise<{ browser: ExtensionBrowser; generationStopVersion: number; applyStopVersion: number }> {
  const [[row], [manager]] = await db.batch([
    upsertExtensionBrowser(managerId, identity, new Date(), modes),
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
    browser: { ...row, canTakeWork: canTakeWork(row.extensionVersion) },
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
