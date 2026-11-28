import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { extensionBrowsers, users } from "@/db/schema";
import { db } from "@/lib/db";
import { type BrowserHeaders, canTakeWork, defaultBrowserName, parseBrowserHeaders } from "@/server/apply/apply-values";
import { type ReadyKind, readyWorkCount } from "@/server/work/work-readiness";
import { settingsVersion } from "@/server/browsers/settings-version";

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
  const [, [row]] = await db.batch([
    upsertExtensionBrowser(managerId, identity, new Date()),
    selectExtensionBrowser(managerId, identity),
  ]);
  return { ...row, canTakeWork: canTakeWork(row.extensionVersion) };
}

export type BrowserModes = { getJdOn: boolean; workMode: "off" | "generation" | "apply" };

// A Chrome row is written again only after this long, unless something in it changed. Nothing reads
// last_seen_at or the modes for live status, and every apply, Generation and heartbeat call used to
// rewrite the row (2026-11-27: one write per call).
const SEEN_REFRESH_SECONDS = 120;

// Registers the Chrome on first sight and records that it was seen, with its modes when given: in
// one statement, which leaves the row alone when it was written in the last 2 minutes and its
// version, name and modes are the same.
function upsertExtensionBrowser(managerId: string, identity: BrowserHeaders, now: Date, modes?: BrowserModes) {
  const changed = [
    sql`${extensionBrowsers.lastSeenAt} < now() - make_interval(secs => ${SEEN_REFRESH_SECONDS})`,
    sql`${extensionBrowsers.extensionVersion} is distinct from ${identity.extensionVersion}`,
    ...(identity.browserName ? [sql`${extensionBrowsers.name} is distinct from ${identity.browserName}`] : []),
    ...(modes ? [
      sql`${extensionBrowsers.getJdOn} is distinct from ${modes.getJdOn}`,
      sql`${extensionBrowsers.workMode} is distinct from ${modes.workMode}`,
    ] : []),
  ];
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
      setWhere: sql.join(changed.map((condition) => sql`(${condition})`), sql` or `),
    });
}

// The Chrome's row as the upsert above left it (run after it, in the same batch).
function selectExtensionBrowser(managerId: string, identity: BrowserHeaders) {
  return db
    .select({
      id: extensionBrowsers.id,
      name: extensionBrowsers.name,
      extensionVersion: extensionBrowsers.extensionVersion,
    })
    .from(extensionBrowsers)
    .where(and(eq(extensionBrowsers.managerId, managerId), eq(extensionBrowsers.browserKey, identity.browserKey)))
    .limit(1);
}

/**
 * A Chrome's heartbeat in one database round trip: registers it as resolveExtensionBrowser does,
 * records which modes it runs, and returns the Manager's Stop-all counters. When the Chrome asks
 * (`ready`), it also says how many jobs are ready for that mode, so the Chrome claims only when
 * there is work (one call instead of a heartbeat plus an empty claim, 2026-11-27).
 */
export async function recordBrowserHeartbeat(
  managerId: string,
  identity: BrowserHeaders,
  modes: BrowserModes,
  ready?: { kind: ReadyKind; scoped: boolean },
): Promise<{ browser: ExtensionBrowser; generationStopVersion: number; applyStopVersion: number; settingsVersion: string | null; ready?: { count: number; key: string } }> {
  const base = [
    upsertExtensionBrowser(managerId, identity, new Date(), modes),
    selectExtensionBrowser(managerId, identity),
    db
      .select({
        generationStopVersion: users.generationStopVersion,
        applyStopVersion: users.applyStopVersion,
      })
      .from(users)
      .where(eq(users.id, managerId))
      .limit(1),
    // The fingerprint of the settings the Chrome keeps copies of (same trip; settings-version.ts).
    settingsVersion(managerId),
  ] as const;
  // The count never costs the heartbeat itself: if it fails, the heartbeat runs again without it
  // (the Chrome then claims as before), so "Stop all" still reaches every Chrome.
  const counted = ready
    ? await db.batch([...base, readyWorkCount(managerId, ready.kind, ready.scoped)]).catch((error) => {
      console.error("Could not count the ready work for a Chrome heartbeat.", error);
      return null;
    })
    : null;
  const [, [row], [manager], [version]] = counted ?? await db.batch(base);
  const readyRow = counted ? counted[4][0] : undefined;
  return {
    browser: { ...row, canTakeWork: canTakeWork(row.extensionVersion) },
    generationStopVersion: manager?.generationStopVersion ?? 0,
    applyStopVersion: manager?.applyStopVersion ?? 0,
    settingsVersion: version?.version ?? null,
    ...(counted ? { ready: { count: Number(readyRow?.count) || 0, key: String(readyRow?.key ?? "0") } } : {}),
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
