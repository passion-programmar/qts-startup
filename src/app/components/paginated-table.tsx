"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

type PaginatedTableProps = {
  columns: { label: string; className?: string }[];
  rows: { id: string; cells: ReactNode[] }[];
  emptyMessage: string;
  pageSize?: number;
  /** Drops the outer frame when the table already sits inside a card. */
  embedded?: boolean;
};

export function PaginatedTable({
  columns,
  rows,
  emptyMessage,
  pageSize: initialPageSize = 10,
  embedded = false,
}: PaginatedTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
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
    <div className={`paginated-table min-w-0 overflow-hidden bg-white ${embedded ? "" : "rounded-2xl border border-slate-200 shadow-sm"}`}>
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
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
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
