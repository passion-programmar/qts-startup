import { Globe } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
import { CompanyDetails, OpenCompany, type CompanyDetail } from "@/app/remote-companies/company-details";
import { Badge } from "@/app/ui/badge";
import { PageHeader } from "@/app/ui/page-header";
import { formatRomaniaDate } from "@/lib/romania-time";
import { requireUser } from "@/lib/session";
import { canViewRemoteCompanies, readRemoteCompaniesPage } from "@/server/remote-companies/remote-companies";
import {
  defaultRemoteCompanyPageSize,
  parseRemoteCompaniesQuery,
  remoteCompanySearchFields,
  remoteCompanySorts,
  type RemoteCompaniesQuery,
  type RemoteCompanySort,
} from "@/server/remote-companies/remote-companies-query";

export const instant = false;

// The address of this page with another sort; the search and page size stay, the page goes back to 1.
function sortHref(query: RemoteCompaniesQuery, sort: RemoteCompanySort): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.q && query.field !== "all") params.set("field", query.field);
  if (sort !== "recent") params.set("sort", sort);
  if (query.size !== defaultRemoteCompanyPageSize) params.set("size", String(query.size));
  const search = params.toString();
  return search ? `/remote-companies?${search}` : "/remote-companies";
}

function SortLinks({ query }: { query: RemoteCompaniesQuery }) {
  return (
    <nav aria-label="Sort companies" className="flex items-center gap-1 rounded-lg bg-subtle p-0.5 ring-1 ring-line">
      {remoteCompanySorts.map((sort) => {
        const active = sort.key === query.sort;
        return (
          <Link
            aria-current={active ? "true" : undefined}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${active ? "bg-card text-primary-text shadow-sm ring-1 ring-line" : "text-fg-muted hover:text-fg"}`}
            href={sortHref(query, sort.key)}
            key={sort.key}
            scroll={false}
          >
            {sort.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Companies with fully remote jobs that QTS has seen: saved as a job or applied as a bid by any
// Manager. The database fills the list itself (and keeps it for good); this page only reads it.
// One line per company; clicking it opens its roles, places, dates and who applied.
// The Super Admin always sees it; a Manager only when the Super Admin turned it on for them.
export default async function RemoteCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireUser();
  if (!(await canViewRemoteCompanies(currentUser))) redirect("/");
  const query = parseRemoteCompaniesQuery(await searchParams);
  const list = await readRemoteCompaniesPage(query);
  const details: CompanyDetail[] = list.companies.map((company) => ({
    companyKey: company.companyKey,
    company: company.company,
    roles: company.roles,
    jobs: company.jobs,
    bids: company.bids,
    lastSeen: company.lastSeen.toISOString(),
    items: company.items.map((role) => ({
      titleKey: role.titleKey,
      title: role.title,
      places: role.places,
      jobs: role.jobs,
      bids: role.bids,
      firstSeen: role.firstSeen.toISOString(),
      lastSeen: role.lastSeen.toISOString(),
    })),
  }));

  return (
    <main className="py-1">
      <PageHeader
        actions={<Badge className="px-3 py-1 text-xs">{list.all} {list.all === 1 ? "company" : "companies"}</Badge>}
        title={<span className="inline-flex items-center gap-2"><Globe aria-hidden="true" className="size-6 text-primary" />Remote companies</span>}
      />
      <CompanyDetails companies={details} searching={Boolean(query.q)}>
        <PaginatedTable
          columns={[
            { label: "Company", className: "w-[46%]" },
            { label: "Remote roles", className: "w-[18%]" },
            { label: "Applied", className: "w-[18%]" },
            { label: "Last seen", className: "w-[18%]" },
          ]}
          emptyMessage={query.q ? "No remote companies match your search" : "No remote jobs saved or applied yet"}
          searchFields={[...remoteCompanySearchFields]}
          server={{
            path: "/remote-companies",
            params: query.sort === "recent" ? {} : { sort: query.sort },
            total: list.total,
            page: list.page,
            pageSize: query.size,
            defaultPageSize: defaultRemoteCompanyPageSize,
            field: query.field,
            query: query.q,
          }}
          toolbar={<SortLinks query={query} />}
          rows={list.companies.map((company, index) => {
            const label = `Open ${company.company}: roles and who applied`;
            return {
              id: company.companyKey,
              cells: [
                <OpenCompany className="font-semibold text-fg hover:text-primary-text hover:underline" index={index} key="company" label={label}>{company.company}</OpenCompany>,
                <OpenCompany className="tabular-nums" index={index} key="roles" label={label}>{company.roles}</OpenCompany>,
                <OpenCompany className="tabular-nums" index={index} key="applied" label={label}>{company.bids}</OpenCompany>,
                <OpenCompany className="text-xs" index={index} key="seen" label={label}>{formatRomaniaDate(company.lastSeen)}</OpenCompany>,
              ],
            };
          })}
        />
      </CompanyDetails>
    </main>
  );
}
