import { Globe } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
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
  type RemoteRole,
} from "@/server/remote-companies/remote-companies-query";

export const instant = false;

const SHOWN_ROLES = 3;
const SHOWN_PLACES = 4;

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

function Places({ places }: { places: string[] }) {
  const shown = places.slice(0, SHOWN_PLACES);
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {shown.map((place) => (
        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success-text ring-1 ring-inset ring-success-ring" key={place}>{place}</span>
      ))}
      {places.length > shown.length && (
        <span className="rounded-full px-1.5 py-0.5 text-[11px] text-fg-muted" title={places.slice(SHOWN_PLACES).join(" · ")}>+{places.length - shown.length}</span>
      )}
    </span>
  );
}

function Role({ role }: { role: RemoteRole }) {
  return (
    <li className="py-1.5 first:pt-0 last:pb-0">
      <span className="block text-sm font-medium text-fg">{role.title}</span>
      <Places places={role.places} />
      <span className="mt-1 block text-[11px] text-fg-muted">
        Saved {role.jobs} · Applied {role.bids} · last seen {formatRomaniaDate(role.lastSeen)}
      </span>
    </li>
  );
}

// The first roles show at once; the rest open under "more roles" (no script needed).
function Roles({ roles }: { roles: RemoteRole[] }) {
  const rest = roles.slice(SHOWN_ROLES);
  return (
    <div>
      <ul className="divide-y divide-line-soft">
        {roles.slice(0, SHOWN_ROLES).map((role, index) => <Role key={`${role.title}-${index}`} role={role} />)}
      </ul>
      {rest.length > 0 && (
        <details className="group mt-1.5">
          <summary className="cursor-pointer select-none text-xs font-semibold text-primary-text hover:underline">
            <span className="group-open:hidden">Show {rest.length} more {rest.length === 1 ? "role" : "roles"}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-1.5 divide-y divide-line-soft">
            {rest.map((role, index) => <Role key={`${role.title}-${index + SHOWN_ROLES}`} role={role} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

// Companies with fully remote jobs that QTS has seen: saved as a job or applied as a bid by any
// Manager. The database fills the list itself (and keeps it for good); this page only reads it.
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
  const offset = (list.page - 1) * query.size;

  return (
    <main className="py-1">
      <PageHeader
        actions={<Badge className="px-3 py-1 text-xs">{list.all} {list.all === 1 ? "company" : "companies"}</Badge>}
        description="Companies with fully remote jobs that any Manager saved or applied to in QTS. The list fills itself and keeps everything. Dates are Romania time."
        title={<span className="inline-flex items-center gap-2"><Globe aria-hidden="true" className="size-6 text-primary" />Remote companies</span>}
      />
      <PaginatedTable
        columns={[
          { label: "No", className: "w-[5%]" },
          { label: "Company", className: "w-[22%]" },
          { label: "Remote roles", className: "w-[45%]" },
          { label: "Saved", className: "w-[8%]" },
          { label: "Applied", className: "w-[8%]" },
          { label: "Last seen", className: "w-[12%]" },
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
        rows={list.companies.map((company, index) => ({
          id: company.companyKey,
          cells: [
            offset + index + 1,
            <div key="company">
              <span className="block font-semibold text-fg">{company.company}</span>
              <span className="text-xs text-fg-muted">{company.roles} remote {company.roles === 1 ? "role" : "roles"}</span>
            </div>,
            <Roles key="roles" roles={company.items} />,
            <span className="tabular-nums" key="saved">{company.jobs}</span>,
            <span className="tabular-nums" key="applied">{company.bids}</span>,
            <span className="text-xs" key="seen">{formatRomaniaDate(company.lastSeen)}</span>,
          ],
        }))}
      />
    </main>
  );
}
