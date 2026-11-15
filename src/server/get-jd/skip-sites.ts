import "server-only";

import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultGetJdSkipSites,
  getJdSkipSitesSettingKey,
  readSavedGetJdSkipSites,
} from "@/server/get-jd/skip-sites-values";

/** The sites Get JD never reads, as Super Admin saved them; the default list until then. */
export async function getGetJdSkipSites(): Promise<{ sites: string[]; saved: boolean }> {
  const [row] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, getJdSkipSitesSettingKey)).limit(1);
  const saved = readSavedGetJdSkipSites(row?.value);
  return saved ? { sites: saved, saved: true } : { sites: [...defaultGetJdSkipSites], saved: false };
}
