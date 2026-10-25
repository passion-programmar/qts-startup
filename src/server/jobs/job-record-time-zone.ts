import "server-only";

import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultJobRecordTimeZone,
  isJobRecordTimeZone,
  jobRecordTimeZoneSettingKey,
} from "@/server/jobs/job-record-time-zones";
import { getJobBusinessDate } from "@/server/jobs/job-values";

/** The time zone Super Admin chose for job record dates (Settings). */
export async function getJobRecordTimeZone(): Promise<string> {
  const [row] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, jobRecordTimeZoneSettingKey)).limit(1);
  return isJobRecordTimeZone(row?.value) ? row.value : defaultJobRecordTimeZone;
}

/** Today's date (YYYY-MM-DD) in the job record time zone. */
export async function getJobRecordDate(now = new Date()): Promise<string> {
  return getJobBusinessDate(now, await getJobRecordTimeZone());
}
