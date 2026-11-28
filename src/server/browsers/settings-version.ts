import "server-only";

import { eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * One short fingerprint of everything the extension keeps a copy of (2026-11-28): the shared text
 * highlights, this Manager's page exclusions and Get JD URL rules, Super Admin's Get JD skip sites,
 * and the Manager's own row (feature switches). Any add, edit or delete changes it. It rides on the
 * heartbeat (the same database trip), so a Chrome refreshes its copies only when something changed,
 * instead of asking every minute (each ask woke the database while the Manager only browsed jobs).
 * Page exclusions have no edit date, so their own text is part of it (an edited one changes it too).
 */
export function settingsVersion(managerId: string) {
  return db
    .select({
      version: sql<string>`md5(concat_ws('|',
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') from text_highlight_rules),
        (select coalesce(string_agg(id::text || '=' || url_rule, ',' order by id), '') from extension_page_exclusions where manager_id = ${managerId}),
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') from extension_job_detection_url_rules where manager_id = ${managerId}),
        (select updated_at::text from settings where key = 'get_jd_skip_sites'),
        ${users.updatedAt}::text
      ))`,
    })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);
}
