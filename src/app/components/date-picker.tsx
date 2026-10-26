"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: "long" }).format(
    new Date(2024, month, 1),
  ),
);

function toDateValue(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}

export function DatePicker({
  id,
  label,
  name,
  defaultValue = "",
  required = false,
  className,
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}) {
  const initialDate = parseDateValue(defaultValue) ?? new Date();
  const [value, setValue] = useState(defaultValue);
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const calendarId = useId();
  const today = new Date();
  const currentYear = today.getFullYear();
  const firstYear = Math.min(currentYear - 120, viewYear);
  const lastYear = Math.max(currentYear + 20, viewYear);
  const todayValue = toDateValue(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const selectedDate = parseDateValue(value);
  const monthStart = new Date(viewYear, viewMonth, 1);
  const gridStart = new Date(viewYear, viewMonth, 1 - monthStart.getDay());
  const dates = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    );
    return {
      date,
      value: toDateValue(date.getFullYear(), date.getMonth(), date.getDate()),
      inMonth: date.getMonth() === viewMonth,
    };
  });

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function changeMonth(amount: number) {
    const next = new Date(viewYear, viewMonth + amount, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function selectDate(dateValue: string) {
    setValue(dateValue);
    const date = parseDateValue(dateValue);
    if (date) {
      setViewYear(date.getFullYear());
      setViewMonth(date.getMonth());
    }
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={pickerRef}>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="relative">
        <input
          aria-haspopup="dialog"
          aria-controls={calendarId}
          aria-required={required}
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-10 text-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          id={id}
          maxLength={10}
          name={name}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            const date = parseDateValue(nextValue);
            if (date) {
              setViewYear(date.getFullYear());
              setViewMonth(date.getMonth());
            }
          }}
          onFocus={() => setOpen(true)}
          pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
          placeholder="YYYY-MM-DD"
          required={required}
          type="text"
          value={value}
        />
        <button
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-controls={calendarId}
          aria-expanded={open}
          className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-lg text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700"
          onClick={() => setOpen((isOpen) => !isOpen)}
          type="button"
        >
          <CalendarDays aria-hidden="true" className="size-4" />
        </button>
      </div>
      {open && (
        <div
          aria-label={`${label} calendar`}
          className="absolute left-0 top-full z-50 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          data-changes-form
          id={calendarId}
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <select
                aria-label="Month"
                className="min-h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                onChange={(event) => setViewMonth(Number(event.target.value))}
                value={viewMonth}
              >
                {monthNames.map((month, index) => (
                  <option key={month} value={index}>{month}</option>
                ))}
              </select>
              <select
                aria-label="Year"
                className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                onChange={(event) => setViewYear(Number(event.target.value))}
                value={viewYear}
              >
                {Array.from(
                  { length: lastYear - firstYear + 1 },
                  (_, index) => firstYear + index,
                ).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Previous month"
                className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100"
                onClick={() => changeMonth(-1)}
                type="button"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
              <button
                aria-label="Next month"
                className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100"
                onClick={() => changeMonth(1)}
                type="button"
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
          <div aria-label="Days of the week" className="mb-1 grid grid-cols-7">
            {weekdays.map((weekday) => (
              <div
                className="py-2 text-center text-[11px] font-semibold text-slate-500"
                key={weekday}
              >
                {weekday}
              </div>
            ))}
          </div>
          <div aria-label="Calendar dates" className="grid grid-cols-7 gap-y-1">
            {dates.map(({ date, value: dateValue, inMonth }) => {
              const isSelected = selectedDate !== null &&
                dateValue === toDateValue(
                  selectedDate.getFullYear(),
                  selectedDate.getMonth(),
                  selectedDate.getDate(),
                );
              const isToday = dateValue === todayValue;
              return (
                <button
                  aria-current={isToday ? "date" : undefined}
                  aria-label={date.toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  aria-pressed={isSelected}
                  className={`mx-auto inline-flex size-9 items-center justify-center rounded-lg text-xs transition focus-visible:outline-indigo-500 ${
                    isSelected
                      ? "bg-indigo-600 font-semibold text-white hover:bg-indigo-700"
                      : isToday
                        ? "font-semibold text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-50"
                        : inMonth
                          ? "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                          : "text-slate-300 hover:bg-slate-50"
                  }`}
                  key={dateValue}
                  onClick={() => selectDate(dateValue)}
                  type="button"
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            {!required ? (
              <button
                className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                onClick={() => {
                  setValue("");
                  setOpen(false);
                }}
                type="button"
              >
                Clear
              </button>
            ) : <span />}
            <button
              className="rounded-md px-2 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
              onClick={() => selectDate(todayValue)}
              type="button"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseMonthValue(value: string): { year: number; month: number } | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(value);
  return match ? { month: Number(match[1]) - 1, year: Number(match[2]) } : null;
}

function toMonthValue(year: number, month: number): string {
  return `${String(month + 1).padStart(2, "0")}/${year}`;
}

/**
 * The same calendar for months (education and work history): a year and its twelve months.
 * The value stays MM/YYYY, as typed before.
 */
export function MonthPicker({
  id,
  label,
  name,
  defaultValue = "",
  required = false,
  className,
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}) {
  const today = new Date();
  const [value, setValue] = useState(defaultValue);
  const [viewYear, setViewYear] = useState(parseMonthValue(defaultValue)?.year ?? today.getFullYear());
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const calendarId = useId();
  const selected = parseMonthValue(value);
  const currentYear = today.getFullYear();
  const firstYear = Math.min(currentYear - 70, viewYear);
  const lastYear = Math.max(currentYear + 10, viewYear);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectMonth(year: number, month: number) {
    setValue(toMonthValue(year, month));
    setViewYear(year);
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={pickerRef}>
      <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          aria-haspopup="dialog"
          aria-controls={calendarId}
          aria-required={required}
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-10 text-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          id={id}
          inputMode="numeric"
          maxLength={7}
          name={name}
          onChange={(event) => {
            setValue(event.target.value);
            const month = parseMonthValue(event.target.value);
            if (month) setViewYear(month.year);
          }}
          onFocus={() => setOpen(true)}
          pattern="(0[1-9]|1[0-2])/[0-9]{4}"
          placeholder="MM/YYYY"
          required={required}
          type="text"
          value={value}
        />
        <button
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-controls={calendarId}
          aria-expanded={open}
          className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-lg text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700"
          onClick={() => setOpen((isOpen) => !isOpen)}
          type="button"
        >
          <CalendarDays aria-hidden="true" className="size-4" />
        </button>
      </div>
      {open && (
        <div
          aria-label={`${label} calendar`}
          className="absolute left-0 top-full z-50 mt-2 w-[17rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          data-changes-form
          id={calendarId}
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              aria-label="Previous year"
              className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100"
              onClick={() => setViewYear((year) => year - 1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <select
              aria-label="Year"
              className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              onChange={(event) => setViewYear(Number(event.target.value))}
              value={viewYear}
            >
              {Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <button
              aria-label="Next year"
              className="inline-flex size-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100"
              onClick={() => setViewYear((year) => year + 1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div aria-label="Months" className="grid grid-cols-3 gap-1.5">
            {monthNames.map((monthName, month) => {
              const isSelected = selected?.year === viewYear && selected.month === month;
              const isCurrent = viewYear === currentYear && month === today.getMonth();
              return (
                <button
                  aria-pressed={isSelected}
                  className={`h-9 rounded-lg text-xs transition focus-visible:outline-indigo-500 ${
                    isSelected
                      ? "bg-indigo-600 font-semibold text-white hover:bg-indigo-700"
                      : isCurrent
                        ? "font-semibold text-indigo-700 ring-1 ring-indigo-300 hover:bg-indigo-50"
                        : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                  }`}
                  key={monthName}
                  onClick={() => selectMonth(viewYear, month)}
                  type="button"
                >
                  {monthName.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            {!required ? (
              <button
                className="rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                onClick={() => {
                  setValue("");
                  setOpen(false);
                }}
                type="button"
              >
                Clear
              </button>
            ) : <span />}
            <button
              className="rounded-md px-2 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
              onClick={() => selectMonth(currentYear, today.getMonth())}
              type="button"
            >
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
