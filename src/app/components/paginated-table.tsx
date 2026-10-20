"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

type PaginatedTableProps = {
  columns: { label: string; className?: string }[];
  rows: { id: string; cells: ReactNode[] }[];
  emptyMessage: string;
  pageSize?: number;
};

export function PaginatedTable({
  columns,
  rows,
  emptyMessage,
  pageSize: initialPageSize = 10,
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
    <div className="overflow-hidden rounded border border-[#dfe3e7] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead className="border-b border-[#e9ecef] bg-[#f8f9fa] text-[11px] font-semibold uppercase tracking-wide text-[#6c757d]">
            <tr>
              {columns.map((column) => (
                <th
                  className={`px-4 py-3 ${column.className ?? ""}`}
                  key={column.label}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e9ecef]">
            {visibleRows.map((row) => (
              <tr className="align-top hover:bg-[#f8f9fa]" key={row.id}>
                {row.cells.map((cell, index) => (
                  <td
                    className={`px-4 py-3 text-[#343a40] ${columns[index]?.className ?? ""}`}
                    key={`${row.id}-${columns[index]?.label ?? index}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="px-4 py-10 text-center text-sm text-[#6c757d]"
                  colSpan={columns.length}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-[#e9ecef] px-4 py-3 text-xs text-[#6c757d] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {rows.length === 0
              ? "0 entries"
              : `Showing ${start + 1} to ${Math.min(start + pageSize, rows.length)} of ${rows.length} entries`}
          </span>
          <label className="flex items-center gap-2">
            <span className="sr-only">Rows per page</span>
            <select
              className="h-8 rounded border border-[#ced4da] bg-white px-2 text-xs text-[#343a40] focus:border-[#86b7fe] focus:outline-none focus:ring-2 focus:ring-[#0d6efd]/20"
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

        <nav aria-label="Table pagination" className="flex items-center gap-1">
          <button
            aria-label="Previous page"
            className="flex size-8 items-center justify-center rounded border border-[#dee2e6] text-[#0d6efd] hover:bg-[#e9ecef] disabled:cursor-not-allowed disabled:text-[#adb5bd]"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          {pageNumbers.map((pageNumber) => (
            <button
              aria-current={currentPage === pageNumber ? "page" : undefined}
              className={`h-8 min-w-8 rounded border px-2 ${
                currentPage === pageNumber
                  ? "border-[#0d6efd] bg-[#0d6efd] text-white"
                  : "border-[#dee2e6] text-[#0d6efd] hover:bg-[#e9ecef]"
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
            className="flex size-8 items-center justify-center rounded border border-[#dee2e6] text-[#0d6efd] hover:bg-[#e9ecef] disabled:cursor-not-allowed disabled:text-[#adb5bd]"
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
