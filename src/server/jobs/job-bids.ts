import { sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";

// Bids are independent records of confirmed applications. A jobs row counts as already applied when
// its candidate has a bid for the same job: the same address, or the same title + company.

const normalizedUrl = (url: typeof jobs.jobUrl | typeof bids.jobUrl | string) =>
  sql`regexp_replace(split_part(btrim(${url}), '#', 1), '/+$', '')`;

export function jobHasBid() {
  return sql<boolean>`exists (
    select 1 from ${bids}
     where ${bids.managerId} = ${jobs.managerId}
       and ${bids.candidateId} = ${jobs.candidateId}
       and (${normalizedUrl(bids.jobUrl)} = ${normalizedUrl(jobs.jobUrl)}
            or ${bids.titleCompanyKey} = ${jobs.titleCompanyKey})
  )`;
}
