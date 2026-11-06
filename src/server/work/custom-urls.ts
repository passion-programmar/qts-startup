import { sql, type SQLWrapper } from "drizzle-orm";
import { autoApplyCustomUrls } from "@/db/schema";

export function matchesManagerCustomUrl(managerId: string, jobUrl: SQLWrapper) {
  return sql<boolean>`exists (
    select 1 from ${autoApplyCustomUrls}
    where ${autoApplyCustomUrls.managerId} = ${managerId}
      and (
        lower(regexp_replace(split_part(lower(btrim(${jobUrl})), '://', 2), '[:/?#].*$', '')) = ${autoApplyCustomUrls.urlPrefix}
        or lower(regexp_replace(split_part(lower(btrim(${jobUrl})), '://', 2), '[:/?#].*$', '')) like ('%.' || ${autoApplyCustomUrls.urlPrefix})
      )
  )`;
}
