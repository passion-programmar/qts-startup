"use client";

// A time box like Google Calendar's: a list every 15 minutes opens under it, and any time can still
// be typed ("9", "930", "14:10"). The list scrolls to the chosen time, or the next one after it.
import { useEffect, useId, useRef, useState } from "react";
import { parseTypedTime, type TimeOption } from "@/server/interviews/interview-values";

export function TimeSelect({
  id,
  name,
  label,
  value,
  options,
  onChange,
  required = false,
  fallbackIndex = 0,
}: {
  id: string;
  name: string;
  /** Read by screen readers; the row shows no label of its own. */
  label: string;
  value: string;
  options: TimeOption[];
  onChange: (value: string) => void;
  required?: boolean;
  /** The option shown first when nothing is chosen yet. */
  fallbackIndex?: number;
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // What is being typed, until it is read as a time (Enter, or leaving the box).
  const [draft, setDraft] = useState<string | null>(null);

  function show() {
    const exact = options.findIndex((option) => option.value === value);
    const after = value ? options.findIndex((option) => option.value > value) : -1;
    setActive(exact >= 0 ? exact : after >= 0 ? after : Math.min(fallbackIndex, options.length - 1));
    setOpen(true);
  }

  function pick(next: string) {
    onChange(next);
    setDraft(null);
    setOpen(false);
  }

  function commit() {
    if (draft === null) return;
    const typed = parseTypedTime(draft);
    if (typed) onChange(typed);
    setDraft(null);
  }

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <div className="relative">
      <input
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-label={label}
        autoComplete="off"
        className="h-10 w-[5.5rem] rounded-lg border border-slate-200 bg-white px-3 text-center text-sm tabular-nums text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        id={id}
        inputMode="numeric"
        maxLength={5}
        name={name}
        onBlur={() => { commit(); setOpen(false); }}
        onChange={(event) => { setDraft(event.target.value); if (!open) show(); }}
        onClick={() => { if (!open) show(); }}
        onFocus={(event) => { event.target.select(); show(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { show(); return; }
            setActive((index) => Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), options.length - 1));
          } else if (event.key === "Enter") {
            // Enter picks or reads the time; it never sends the form from here.
            event.preventDefault();
            if (draft !== null) { commit(); setOpen(false); }
            else if (open && options[active]) pick(options[active].value);
          } else if (event.key === "Escape" && open) {
            // Closes the list only, not the window around it.
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
            setOpen(false);
          }
        }}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        placeholder="HH:MM"
        required={required}
        role="combobox"
        title="24-hour time, e.g. 14:30"
        type="text"
        value={draft ?? value}
      />
      {open && options.length > 0 && (
        <ul
          className="absolute left-0 top-full z-50 mt-1 max-h-60 min-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
          id={listId}
          ref={listRef}
          role="listbox"
        >
          {options.map((option, index) => (
            <li
              aria-selected={option.value === value}
              className={`cursor-pointer whitespace-nowrap px-3 py-1.5 text-sm tabular-nums ${index === active ? "bg-indigo-50 text-indigo-700" : "text-slate-700"} ${option.value === value ? "font-semibold" : ""}`}
              id={`${listId}-${index}`}
              key={option.value}
              // Keeps the box focused, so leaving it does not close the list before the pick.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option.value)}
              onMouseEnter={() => setActive(index)}
              role="option"
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
