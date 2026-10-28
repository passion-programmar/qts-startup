"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

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
};

export function PaginatedTable({
  columns,
  rows: allRows,
  emptyMessage,
  pageSize: initialPageSize = 10,
  embedded = false,
  searchFields,
}: PaginatedTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [searchField, setSearchField] = useState("all");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = searchFields && needle
    ? allRows.filter((row) => {
      const values = searchField === "all" ? Object.values(row.search ?? {}) : [row.search?.[searchField] ?? ""];
      return values.some((value) => value.toLowerCase().includes(needle));
    })
    : allRows;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visibleRows = rows.slice(start, start + pageSize);
  const firstPage = Math.max(1, Math.min(currentPage - 2, pageCount - 4));
  const lastPage = Math.min(pageCount, firstPage + 4);
  const pageNumbers = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );

  return (
    // overflow-clip rounds the corners like overflow-hidden but still lets the pagination bar stick.
    <div className={`paginated-table min-w-0 overflow-clip bg-white ${embedded ? "" : "rounded-2xl border border-slate-200 shadow-sm"}`}>
      {searchFields && (
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="sr-only">Search in</span>
            <select
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => {
                setSearchField(event.target.value);
                setPage(1);
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
                setPage(1);
              }}
              placeholder={`Search ${searchField === "all" ? "all fields" : searchFields.find((field) => field.key === searchField)?.label.toLowerCase() ?? ""}`}
              type="search"
              value={query}
            />
          </label>
        </div>
      )}
      <div
        aria-label="Table data; scroll horizontally to see all columns"
        className="paginated-table__scroll"
        role="region"
        tabIndex={0}
      >
        <table className="paginated-table__grid w-full border-collapse text-left text-[13px]">
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
            {rows.length === 0 && (
              <tr className="paginated-table__empty-row">
                <td
                  className="px-4 py-14 text-center text-sm text-slate-500"
                  colSpan={columns.length}
                >
                  {allRows.length > 0 ? "No entries match your search" : emptyMessage}
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
            {rows.length === 0
              ? "0 entries"
              : `Showing ${start + 1} to ${Math.min(start + pageSize, rows.length)} of ${rows.length} entries`}
          </span>
          <label className="flex items-center gap-2">
            <span className="sr-only">Rows per page</span>
            <select
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              value={pageSize}
            >
              {[10, 25, 50].map((size) => (
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
