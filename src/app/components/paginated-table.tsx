"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

type PaginatedTableProps = {
  columns: { label: string; className?: string }[];
  /** search: each row's text per search field, matched by the search bar. */
  rows: { id: string; cells: ReactNode[]; search?: Record<string, string> }[];
  emptyMessage: string;
  pageSize?: number;
  /** Drops the outer frame when the table already sits inside a card. */
  embedded?: boolean;
  /** Shows a search bar above the table that matches one chosen field, or all of them. */
  searchFields?: { key: string; label: string }[];
  /** Extra controls at the right end of the search bar, such as an Export button. */
  toolbar?: ReactNode;
  /**
   * Rows already searched and paged on the server: rows is one page, and paging or searching opens a
   * new page address (keeping params) instead of filtering in the browser.
   */
  server?: {
    path: string;
    params: Record<string, string>;
    total: number;
    page: number;
    pageSize: number;
    defaultPageSize: number;
    field: string;
    query: string;
  };
};

const pageSizes = [10, 25, 50];

export function PaginatedTable({
  columns,
  rows: allRows,
  emptyMessage,
  pageSize: initialPageSize = 10,
  embedded = false,
  searchFields,
  toolbar,
  server,
}: PaginatedTableProps) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(initialPageSize);
  const [searchField, setSearchField] = useState(server?.field ?? "all");
  const [query, setQuery] = useState(server?.query ?? "");
  const needle = query.trim().toLowerCase();

  /** Opens the same page with other page, size or search values; the rest of the address stays. */
  function navigate(changes: { page?: number; size?: number; field?: string; q?: string }) {
    if (!server) return;
    const next = { page: server.page, size: server.pageSize, field: server.field, q: server.query, ...changes };
    if (changes.page === undefined) next.page = 1;
    const params = new URLSearchParams(server.params);
    const words = next.q.trim();
    if (words) params.set("q", words);
    if (words && next.field !== "all") params.set("field", next.field);
    if (next.page > 1) params.set("page", String(next.page));
    if (next.size !== server.defaultPageSize) params.set("size", String(next.size));
    const search = params.toString();
    setRequestedSearch(`${words ? next.field : "all"}\n${words}`);
    startNavigation(() => router.push(search ? `${server.path}?${search}` : server.path, { scroll: false }));
  }

  // The address can change elsewhere (a menu link, Back): the search bar then shows its words. A page
  // this bar asked for leaves the bar alone, so words typed while it loaded stay.
  const serverSearch = server ? `${server.query ? server.field : "all"}\n${server.query}` : "";
  const [shownServerSearch, setShownServerSearch] = useState(serverSearch);
  const [requestedSearch, setRequestedSearch] = useState<string | null>(null);
  if (server && shownServerSearch !== serverSearch) {
    setShownServerSearch(serverSearch);
    if (serverSearch !== requestedSearch) {
      setQuery(server.query);
      setSearchField(server.field);
    }
  }

  // A server search waits for a short pause in typing, then opens the first matching page.
  useEffect(() => {
    if (!server || query.trim() === server.query.trim()) return;
    const timer = setTimeout(() => navigate({ q: query, field: searchField }), 400);
    return () => clearTimeout(timer);
    // Only typing restarts the pause; navigate reads the latest values when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rows = server || !searchFields || !needle
    ? allRows
    : allRows.filter((row) => {
      const values = searchField === "all" ? Object.values(row.search ?? {}) : [row.search?.[searchField] ?? ""];
      return values.some((value) => value.toLowerCase().includes(needle));
    });
  const total = server ? server.total : rows.length;
  const pageSize = server ? server.pageSize : localPageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = server ? Math.min(server.page, pageCount) : Math.min(localPage, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visibleRows = server ? rows : rows.slice(start, start + pageSize);
  const setPage = (next: number) => (server ? navigate({ page: next }) : setLocalPage(next));
  const firstPage = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  const lastPage = Math.min(pageCount, firstPage + 4);
  const pageNumbers = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );

  return (
    // overflow-clip rounds the corners like overflow-hidden but still lets the pagination bar stick.
    <div aria-busy={navigating || undefined} className={`paginated-table min-w-0 overflow-clip bg-white ${embedded ? "" : "rounded-2xl border border-slate-200 shadow-sm"}`}>
      {searchFields && (
        // The search bar stays under the page header while the table scrolls.
        <div className="sticky top-(--header-height) z-20 flex flex-col gap-2 border-b border-slate-200 bg-white px-4 py-3 shadow-[0_4px_12px_-8px_rgba(15,23,42,0.25)] sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="sr-only">Search in</span>
            <select
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => {
                setSearchField(event.target.value);
                if (!server) setLocalPage(1);
                else if (query.trim()) navigate({ field: event.target.value, q: query });
              }}
              value={searchField}
            >
              <option value="all">All fields</option>
              {searchFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
            </select>
          </label>
          <label className="relative min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">Search</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => {
                setQuery(event.target.value);
                if (!server) setLocalPage(1);
              }}
              placeholder={`Search ${searchField === "all" ? "all fields" : searchFields.find((field) => field.key === searchField)?.label.toLowerCase() ?? ""}`}
              type="search"
              value={query}
            />
          </label>
          {toolbar}
        </div>
      )}
      <div
        aria-label="Table data; scroll horizontally to see all columns"
        className="paginated-table__scroll"
        role="region"
        tabIndex={0}
      >
        <table className={`paginated-table__grid w-full border-collapse text-left text-[13px] transition-opacity ${navigating ? "opacity-60" : ""}`}>
          <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              {columns.map((column) => (
                <th
                  className={`whitespace-normal px-3 py-3 sm:px-4 ${column.className ?? ""}`}
                  key={column.label}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row) => (
              <tr className="align-top transition-colors hover:bg-indigo-50/40" key={row.id}>
                {row.cells.map((cell, index) => (
                  <td
                    className={`whitespace-normal px-3 py-3.5 text-slate-700 sm:px-4 ${columns[index]?.className ?? ""}`}
                    data-label={columns[index]?.label}
                    key={`${row.id}-${columns[index]?.label ?? index}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr className="paginated-table__empty-row">
                <td
                  className="px-4 py-14 text-center text-sm text-slate-500"
                  colSpan={columns.length}
                >
                  {server ? emptyMessage : allRows.length > 0 ? "No entries match your search" : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* The pagination bar stays at the bottom of the screen while the table scrolls past it. */}
      <div className="paginated-table__pager sticky bottom-0 z-10 flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 shadow-[0_-4px_12px_-8px_rgba(15,23,42,0.25)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {total === 0
              ? "0 entries"
              : `Showing ${start + 1} to ${Math.min(start + pageSize, total)} of ${total} entries`}
          </span>
          <label className="flex items-center gap-2">
            <span className="sr-only">Rows per page</span>
            <select
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => {
                if (server) navigate({ size: Number(event.target.value) });
                else {
                  setLocalPageSize(Number(event.target.value));
                  setLocalPage(1);
                }
              }}
              value={pageSize}
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>per page</span>
          </label>
        </div>

        <nav aria-label="Table pagination" className="flex flex-wrap items-center gap-1 sm:flex-nowrap">
          <button
            aria-label="Previous page"
            className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-200"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          {pageNumbers.map((pageNumber) => (
            <button
              aria-current={currentPage === pageNumber ? "page" : undefined}
              className={`h-8 min-w-8 rounded-lg border px-2 font-medium ${
                currentPage === pageNumber
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
              }`}
              key={pageNumber}
              onClick={() => setPage(pageNumber)}
              type="button"
            >
              {pageNumber}
            </button>
          ))}
          <button
            aria-label="Next page"
            className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-200"
            disabled={currentPage === pageCount}
            onClick={() => setPage(currentPage + 1)}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </nav>
      </div>
    </div>
  );
}
