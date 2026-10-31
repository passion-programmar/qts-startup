import { sql, type SQL } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { computeJobKey, computeTitleCompanyKey, normalizeJobKeyUrl, platformJobKey } from "@/server/jobs/job-key";
import { isHttpUrl } from "@/server/jobs/job-values";

export type GetJdIdentity = { jobUrl: string; jobTitle: string; company: string };

export function readGetJdIdentity(value: unknown): GetJdIdentity | null {
  if (!value || typeof value !== "object" || !("job" in value)) return null;
  const job = value.job;
  if (!job || typeof job !== "object") return null;
  const { jobUrl, jobTitle = "", company = "" } = job as Record<string, unknown>;
  if (typeof jobUrl !== "string" || jobUrl.length > 2048 || !isHttpUrl(jobUrl)
    || typeof jobTitle !== "string" || jobTitle.length > 500
    || typeof company !== "string" || company.length > 500) return null;
  return { jobUrl, jobTitle: jobTitle.trim(), company: company.trim() };
}

// Mirrors the existing URL key rules for historical rows without stored URL keys. No new table,
// schema function, record history, or confidential row data is needed by this existence query.
function normalizedStoredUrl(column: SQL): SQL {
  return sql`(select 'https://' || regexp_replace(regexp_replace(lower(parts[1]), '^www[.]', ''),
      case when ${column} ~* '^https:' then ':443$' else ':80$' end, '')
    || regexp_replace(coalesce(parts[2], ''), '/+$', '')
    || coalesce((select '?' || string_agg(piece, '&' order by split_part(piece, '=', 1))
       from unnest(string_to_array(parts[3], '&')) as parameters(piece)
       where piece <> '' and split_part(piece, '=', 1) !~* '^(utm_.+|gclid|fbclid|msclkid|dclid|mc_cid|mc_eid|_hsenc|_hsmi|ref|refid|ref_id|referrer|source|src|trk|trkinfo|trackingid|tracking_id|lever-source|lever-via|gh_src|ccuid|eid|origin|lipi|midtoken|midsig)$'), '')
    from regexp_matches(split_part(btrim(${column}), '#', 1), '^https?://([^/?#]+)([^?#]*)(?:[?]([^#]*))?', 'i') as matched(parts))`;
}

function identityCondition(identity: GetJdIdentity, url: SQL, title: SQL, company: SQL, titleKey: SQL): SQL {
  const normalized = normalizeJobKeyUrl(identity.jobUrl);
  const titleCompany = computeTitleCompanyKey(identity.jobTitle, identity.company);
  const platform = platformJobKey(identity.jobUrl);
  // Bids deliberately store no job_key. Match common platform identifiers in their saved URL.
  let platformMatch: SQL = sql`false`;
  if (platform) {
    const [provider, identifier] = platform.split(":");
    if (provider === "linkedin") platformMatch = sql`${url} ~* ${`^https?://([^/]+\\.)?linkedin\\.com/.*(?:/|currentJobId=)${identifier}(?:[/?&#-]|$)`}`;
    if (provider === "indeed") platformMatch = sql`${url} ~* ${`^https?://([^/]+\\.)?indeed\\.[^/]+/.*[?&](jk|vjk)=${identifier}(&|$)`}`;
    if (provider === "greenhouse") platformMatch = sql`(${url} ~* ${`^https?://([^/]+\\.)?greenhouse\\.(io|com)/.*/jobs/${identifier}([/?#]|$)`} or ${url} ~* ${`[?&]gh_jid=${identifier}(&|$)`})`;
    if (provider === "lever" || provider === "ashby") platformMatch = sql`${url} ~* ${`^https?://([^/]+\\.)?${provider === "lever" ? "lever\\.co" : "ashbyhq\\.com"}/.*${identifier}([/?#]|$)`}`;
  }
  const fallbackTitle = sql`regexp_replace(lower(btrim(${title})), '[^[:alnum:]]+', ' ', 'g')`;
  const fallbackCompany = sql`regexp_replace(btrim(regexp_replace(lower(btrim(${company})), '[^[:alnum:]]+', ' ', 'g')), '([[:space:]]+(inc|incorporated|l[[:space:]]*l[[:space:]]*c|ltd|limited|gmbh|corp|corporation|co|company|plc|ag|sa|bv|oy|ab|pty|s[[:space:]]*r[[:space:]]*l))+$', '', 'i')`;
  return sql`(${normalizedStoredUrl(url)} = ${normalized} or ${platformMatch}
    or (${Boolean(titleCompany)} and (${titleKey} = ${titleCompany}
      or (${titleKey} is null and btrim(${fallbackTitle}) = ${titleCompany.split("|")[0] || ""}
        and btrim(${fallbackCompany}) = ${titleCompany.split("|")[1] || ""}))))`;
}

export function globalJobPrecheckQuery(identity: GetJdIdentity): SQL {
  const jobKey = computeJobKey({ url: identity.jobUrl, title: identity.jobTitle, company: identity.company });
  return sql`select (
    exists(select 1 from ${jobs} where ${jobs.jobKey} = ${jobKey}
      or ${identityCondition(identity, sql`${jobs.jobUrl}`, sql`${jobs.jobTitle}`, sql`${jobs.company}`, sql`${jobs.titleCompanyKey}`)})
    or exists(select 1 from ${bids} where ${identityCondition(identity, sql`${bids.jobUrl}`, sql`${bids.jobTitle}`, sql`${bids.company}`, sql`${bids.titleCompanyKey}`)})
  ) as skip`;
}
