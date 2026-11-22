import { sql, type SQL } from "drizzle-orm";
import { normalizeCompanyName } from "@/server/jobs/job-key";
import { likePattern } from "@/server/jobs/jobs-list-query";

// The Remote companies page: every company with fully remote jobs that QTS has seen (saved as a job or
// applied as a bid, by any Manager), one row per company, its roles inside. The rows are written only
// by the database (migration 0105 triggers); this file reads them. Pure, so tests run the real SQL.

export const remoteCompanySearchFields = [
  { key: "company", label: "Company" },
  { key: "title", label: "Job title" },
  { key: "place", label: "Place" },
] as const;

export const remoteCompanySorts = [
  { key: "recent", label: "Recent" },
  { key: "roles", label: "Most roles" },
  { key: "name", label: "A–Z" },
] as const;

type SearchField = (typeof remoteCompanySearchFields)[number]["key"] | "all";
export type RemoteCompanySort = (typeof remoteCompanySorts)[number]["key"];

export const defaultRemoteCompanyPageSize = 25;
const pageSizes = [10, 25, 50];

export type RemoteCompaniesQuery = { field: SearchField; q: string; sort: RemoteCompanySort; page: number; size: number };

export type RemoteRole = {
  title: string;
  places: string[];
  jobs: number;
  bids: number;
  firstSeen: Date;
  lastSeen: Date;
};

export type RemoteCompany = {
  companyKey: string;
  company: string;
  roles: number;
  jobs: number;
  bids: number;
  lastSeen: Date;
  items: RemoteRole[];
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseRemoteCompaniesQuery(raw: Record<string, string | string[] | undefined>): RemoteCompaniesQuery {
  const field = first(raw.field);
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page), 10);
  const size = Number.parseInt(first(raw.size), 10);
  return {
    field: remoteCompanySearchFields.some((entry) => entry.key === field) ? field as SearchField : "all",
    q: first(raw.q).slice(0, 200),
    sort: remoteCompanySorts.some((entry) => entry.key === sort) ? sort as RemoteCompanySort : "recent",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 100_000) : 1,
    size: pageSizes.includes(size) ? size : defaultRemoteCompanyPageSize,
  };
}

// A company is also found by its key without spaces, so "nix" finds "N-iX LLC" (the key drops case,
// punctuation and legal endings, like the rest of QTS).
function searchCondition(query: RemoteCompaniesQuery): SQL {
  const words = query.q.trim();
  if (!words) return sql`true`;
  const pattern = likePattern(words);
  const key = normalizeCompanyName(words).replace(/ /g, "");
  const company = key
    ? sql`(r.company ilike ${pattern} or replace(r.company_key, ' ', '') like ${likePattern(key)})`
    : sql`r.company ilike ${pattern}`;
  const byField = {
    company,
    title: sql`r.job_title ilike ${pattern}`,
    place: sql`array_to_string(r.places, ' ') ilike ${pattern}`,
  };
  return query.field === "all" ? sql`(${byField.company} or ${byField.title} or ${byField.place})` : byField[query.field];
}

function orderBy(sort: RemoteCompanySort, alias: string): SQL {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  if (sort === "roles") return sql`${column("roles")} desc, ${column("last_seen")} desc, ${column("company_key")}`;
  if (sort === "name") return sql`lower(${column("company")}), ${column("company_key")}`;
  return sql`${column("last_seen")} desc, ${column("company_key")}`;
}

/**
 * One trip: the companies on this page with their matching roles (newest first), how many companies
 * match, and how many there are in all. With a search, a company shows only its matching roles.
 */
export function remoteCompaniesPageQuery(query: RemoteCompaniesQuery, page: number): SQL {
  return sql`
    with matched as (
      select r.* from remote_company_jobs r where ${searchCondition(query)}
    ),
    grouped as (
      select company_key,
        (array_agg(company order by last_seen_at desc))[1] as company,
        count(*)::int as roles,
        sum(job_count)::int as jobs,
        sum(bid_count)::int as bids,
        max(last_seen_at) as last_seen
      from matched
      group by company_key
    ),
    paged as (
      select * from grouped g order by ${orderBy(query.sort, "g")} limit ${query.size} offset ${(page - 1) * query.size}
    )
    select
      (select count(*)::int from grouped) as "total",
      (select count(distinct company_key)::int from remote_company_jobs) as "all",
      coalesce((
        select json_agg(json_build_object(
          'companyKey', p.company_key,
          'company', p.company,
          'roles', p.roles,
          'jobs', p.jobs,
          'bids', p.bids,
          'lastSeen', p.last_seen,
          'items', (
            select json_agg(json_build_object(
              'title', m.job_title,
              'places', m.places,
              'jobs', m.job_count,
              'bids', m.bid_count,
              'firstSeen', m.first_seen_at,
              'lastSeen', m.last_seen_at
            ) order by m.last_seen_at desc, m.title_key)
            from matched m where m.company_key = p.company_key
          )
        ) order by ${orderBy(query.sort, "p")})
        from paged p
      ), '[]'::json) as "companies"
  `;
}

type RawRole = Omit<RemoteRole, "firstSeen" | "lastSeen"> & { firstSeen: string; lastSeen: string };
type RawCompany = Omit<RemoteCompany, "lastSeen" | "items"> & { lastSeen: string; items: RawRole[] | null };
export type RemoteCompaniesRow = { total: number; all: number; companies: RawCompany[] | string | null };

/** The query's one row as page data (JSON text or parsed JSON, both accepted). */
export function toRemoteCompanies(row: RemoteCompaniesRow | undefined): { total: number; all: number; companies: RemoteCompany[] } {
  const raw = typeof row?.companies === "string" ? JSON.parse(row.companies) as RawCompany[] : row?.companies ?? [];
  return {
    total: Number(row?.total ?? 0),
    all: Number(row?.all ?? 0),
    companies: raw.map((company) => ({
      companyKey: company.companyKey,
      company: company.company,
      roles: Number(company.roles),
      jobs: Number(company.jobs),
      bids: Number(company.bids),
      lastSeen: new Date(company.lastSeen),
      items: (company.items ?? []).map((role) => ({
        title: role.title,
        places: role.places ?? [],
        jobs: Number(role.jobs),
        bids: Number(role.bids),
        firstSeen: new Date(role.firstSeen),
        lastSeen: new Date(role.lastSeen),
      })),
    })),
  };
}
