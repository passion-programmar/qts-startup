"use client";

// A Manager's candidates (People page): LinkedIn status cards that filter, a search box, category
// tabs, and a short table (Candidate · Contact · LinkedIn · Active · ⋯). Everything filters in the
// browser; only the category is kept in the address, so a refresh keeps it.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Check, Mail, Phone, Search, X } from "lucide-react";
import { PaginatedTable } from "@/app/components/paginated-table";
import { Badge, Count } from "@/app/ui/badge";
import { cn } from "@/app/ui/cn";
import {
  CandidateRowMenu,
  COPIED_EVENT,
  CopyableAccountField,
  LINKEDIN_STATUS_STYLES,
  LinkedInStatusMenu,
  ToggleCandidateAccountStatusForm,
} from "@/app/users/row-actions";
import { CANDIDATES_CHANNEL } from "@/app/users/candidate-tab";
import { LINKEDIN_STATUS_LABELS, LINKEDIN_STATUSES, type LinkedInStatus } from "@/server/users/linkedin-status";
import { labelTextColor } from "@/server/users/manager-category-color";

export type CandidateRowData = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  /** The Super Admin's colour for the category (null = none). */
  categoryColor: string | null;
  label: string;
  labelColor: string | null;
  email: string | null;
  phone: string | null;
  linkedinStatus: LinkedInStatus;
  linkedinChangedAt: string | null;
  active: boolean;
  deleted: boolean;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A soft tint of the Manager's label colour, readable in both themes (the text stays the theme's). */
function tint(color: string | null, amount: number): string | undefined {
  return color && HEX_COLOR.test(color) ? `color-mix(in srgb, ${color} ${amount}%, transparent)` : undefined;
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
}

function Avatar({ name, color, muted }: { name: string; color: string | null; muted: boolean }) {
  const style: CSSProperties | undefined = tint(color, 22)
    ? { backgroundColor: tint(color, 22), boxShadow: `inset 0 0 0 1px ${tint(color, 50)}` }
    : undefined;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold tracking-wide text-fg",
        !style && "bg-primary-soft text-primary-text ring-1 ring-inset ring-primary-ring",
        muted && "opacity-50",
      )}
      style={style}
    >
      {initials(name)}
    </span>
  );
}

/** The Manager's label as a solid chip in its colour (text in black or white, whichever reads). */
function LabelChip({ label, color }: { label: string; color: string | null }) {
  const valid = color && HEX_COLOR.test(color) ? color : null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 ring-inset ring-black/10",
        !valid && "bg-line-soft text-fg-soft ring-line",
      )}
      style={valid ? { backgroundColor: valid, color: labelTextColor(valid) } : undefined}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The short "Copied" message at the bottom of the screen after a click-to-copy. */
function CopyToast() {
  const [message, setMessage] = useState<{ text: string; ok: boolean; at: number } | null>(null);
  useEffect(() => {
    const onCopied = (event: Event) => {
      const value = (event as CustomEvent<string | null>).detail;
      const text = value === null ? "Could not copy" : `Copied ${value.length > 42 ? `${value.slice(0, 40)}…` : value}`;
      setMessage({ text, ok: value !== null, at: Date.now() });
    };
    window.addEventListener(COPIED_EVENT, onCopied);
    return () => window.removeEventListener(COPIED_EVENT, onCopied);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 1800);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {message ? (
        <div className="flex max-w-full items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-sm font-medium text-fg shadow-lg" key={message.at}>
          {message.ok ? <Check aria-hidden="true" className="size-4 shrink-0 text-success" /> : <X aria-hidden="true" className="size-4 shrink-0 text-danger" />}
          <span className="truncate">{message.text}</span>
        </div>
      ) : null}
    </div>
  );
}

/** One part of the LinkedIn segmented control; the chosen one looks raised. */
function Segment({
  label,
  value,
  dot,
  active,
  onClick,
}: {
  label: string;
  value: number;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        active ? "bg-card text-fg shadow-sm ring-1 ring-line" : "text-fg-muted hover:text-fg",
      )}
      onClick={onClick}
      type="button"
    >
      {dot ? <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} /> : null}
      {label}
      <span className={cn("tabular-nums", active ? "text-fg-muted" : "text-fg-faint")}>{value}</span>
    </button>
  );
}

export function CandidateBoard({ candidates, initialCategory }: { candidates: CandidateRowData[]; initialCategory: string }) {
  const [category, setCategory] = useState(initialCategory);
  const [linkedin, setLinkedin] = useState<LinkedInStatus | "all">("all");
  const [query, setQuery] = useState("");
  const router = useRouter();

  // A candidate saved in its Edit tab: reload the rows here.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CANDIDATES_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data === "saved") router.refresh();
    };
    return () => channel.close();
  }, [router]);

  // One tab per category, in the order the rows come (grouped A–Z by category).
  const categoryTabs = useMemo(() => {
    const tabs: { key: string; label: string; count: number; color?: string | null }[] = [];
    for (const candidate of candidates) {
      const tab = tabs.find((item) => item.key === candidate.categoryKey);
      if (tab) tab.count += 1;
      else tabs.push({ key: candidate.categoryKey, label: candidate.categoryName, count: 1, color: candidate.categoryColor });
    }
    return tabs;
  }, [candidates]);
  const activeCategory = categoryTabs.some((tab) => tab.key === category) ? category : "all";

  const inCategory = activeCategory === "all" ? candidates : candidates.filter((candidate) => candidate.categoryKey === activeCategory);
  const current = inCategory.filter((candidate) => !candidate.deleted);
  const statusCounts = Object.fromEntries(
    LINKEDIN_STATUSES.map((status) => [status, current.filter((candidate) => candidate.linkedinStatus === status).length]),
  ) as Record<LinkedInStatus, number>;
  const activeCount = current.filter((candidate) => candidate.active).length;

  const needle = query.trim().toLowerCase();
  const shown = inCategory.filter((candidate) =>
    (linkedin === "all" || (!candidate.deleted && candidate.linkedinStatus === linkedin))
    && (!needle || [candidate.name, candidate.email, candidate.phone, candidate.label, candidate.phone?.replace(/\s+/g, "")]
      .some((value) => value?.toLowerCase().includes(needle))));
  const groupCounts = new Map<string, number>();
  for (const candidate of shown) groupCounts.set(candidate.categoryKey, (groupCounts.get(candidate.categoryKey) ?? 0) + 1);

  function pickCategory(key: string) {
    setCategory(key);
    window.history.replaceState(null, "", key === "all" ? "/users" : `/users?category=${encodeURIComponent(key)}`);
  }

  const inactiveNote = current.length - activeCount > 0 ? `${activeCount} active · ${current.length - activeCount} inactive` : `${activeCount} active`;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
        {/* Row 1: the categories as tabs; the open one is underlined in its colour. */}
        <div className="flex items-center border-b border-line pr-4">
          <nav aria-label="Candidate categories" className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ key: "all", label: "All", count: candidates.length, color: null }, ...categoryTabs].map((tab) => {
              const open = tab.key === activeCategory;
              const color = tab.color && HEX_COLOR.test(tab.color) ? tab.color : null;
              return (
                <button
                  aria-current={open ? "page" : undefined}
                  className={cn(
                    "relative inline-flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-medium transition-colors",
                    open ? "text-fg" : "text-fg-muted hover:text-fg",
                  )}
                  key={tab.key}
                  onClick={() => pickCategory(tab.key)}
                  type="button"
                >
                  {color ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} /> : null}
                  {tab.label}
                  <Count value={tab.count} />
                  <span
                    aria-hidden="true"
                    className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", open ? (color ? "" : "bg-primary") : "bg-transparent")}
                    style={open && color ? { backgroundColor: color } : undefined}
                  />
                </button>
              );
            })}
          </nav>
          <span className="hidden shrink-0 pl-3 text-xs text-fg-faint lg:inline">
            {inCategory.length} {inCategory.length === 1 ? "candidate" : "candidates"} · {inactiveNote}
          </span>
        </div>

        {/* Row 2: search on the left, the LinkedIn filter on the right. */}
        <div className="flex flex-col gap-2 p-2.5 lg:flex-row lg:items-center">
          <label className="relative min-w-0 lg:w-80 lg:shrink-0">
            <span className="sr-only">Search candidates</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
            <input
              className="h-9 w-full rounded-control border border-line bg-subtle pl-9 pr-8 text-sm text-fg placeholder:text-fg-faint focus:border-primary-ring focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary-soft"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, phone or label"
              type="text"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-fg-faint hover:bg-line-soft hover:text-fg"
                onClick={() => setQuery("")}
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </label>
          <div className="flex min-w-0 items-center gap-2.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] lg:ml-auto [&::-webkit-scrollbar]:hidden">
            {query || linkedin !== "all" ? (
              <button
                className="shrink-0 text-xs font-semibold text-primary-text hover:underline"
                onClick={() => {
                  setQuery("");
                  setLinkedin("all");
                }}
                type="button"
              >
                Clear filters
              </button>
            ) : null}
            <span className="shrink-0 text-xs font-semibold text-fg-muted">LinkedIn</span>
            <div aria-label="LinkedIn status filter" className="inline-flex shrink-0 gap-0.5 rounded-control border border-line bg-subtle p-0.5" role="group">
              <Segment active={linkedin === "all"} label="All" onClick={() => setLinkedin("all")} value={inCategory.length} />
              {(["live", "applying", "none", "blocked"] as const).map((status) => (
                <Segment
                  active={linkedin === status}
                  dot={LINKEDIN_STATUS_STYLES[status].dot}
                  key={status}
                  label={LINKEDIN_STATUS_LABELS[status]}
                  onClick={() => setLinkedin(linkedin === status ? "all" : status)}
                  value={statusCounts[status]}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <PaginatedTable
        columns={[
          { label: "Candidate", className: "w-[25%]" },
          { label: "Label", className: "w-[18%]" },
          { label: "Contact", className: "w-[27%]" },
          { label: "LinkedIn", className: "w-[12%]" },
          { label: "Active", className: "w-[13%]" },
          { label: "Actions", className: "w-[5%] text-right", header: <span className="sr-only">Actions</span> },
        ]}
        emptyMessage={candidates.length ? "No candidates match" : "No candidate accounts yet"}
        key={`${activeCategory}|${linkedin}|${needle}`}
        rows={shown.map((candidate) => ({
          id: candidate.id,
          // On a category tab every row has the same category, so the heading row is left out.
          group: activeCategory === "all" ? `${candidate.categoryName} · ${groupCounts.get(candidate.categoryKey) ?? 0}` : undefined,
          cells: [
            <div className="flex min-w-0 items-center gap-3" key="candidate">
              <Avatar color={candidate.labelColor} muted={candidate.deleted || !candidate.active} name={candidate.name} />
              <div className="min-w-0">
                <CopyableAccountField
                  ariaLabel={`Copy full name for ${candidate.name}`}
                  className={cn("font-semibold", candidate.deleted || !candidate.active ? "text-fg-muted" : "text-fg")}
                  value={candidate.name}
                >
                  <span className="truncate">{candidate.name}</span>
                </CopyableAccountField>
              </div>
            </div>,
            candidate.label ? (
              <CopyableAccountField ariaLabel={`Copy label for ${candidate.name}`} key="label" value={candidate.label}>
                <LabelChip color={candidate.labelColor} label={candidate.label} />
              </CopyableAccountField>
            ) : (
              <span className="text-xs text-fg-faint" key="label">No label</span>
            ),
            <div className="min-w-0 space-y-1 text-[13px]" key="contact">
              {candidate.email ? (
                <CopyableAccountField ariaLabel={`Copy email for ${candidate.name}`} className="text-fg-soft" icon value={candidate.email}>
                  <Mail aria-hidden="true" className="size-3.5 shrink-0 text-fg-faint" />
                  <span className="truncate">{candidate.email}</span>
                </CopyableAccountField>
              ) : <span className="block text-fg-faint">No email</span>}
              {candidate.phone ? (
                <div>
                  <CopyableAccountField ariaLabel={`Copy phone for ${candidate.name}`} className="text-fg-muted" icon value={candidate.phone}>
                    <Phone aria-hidden="true" className="size-3.5 shrink-0 text-fg-faint" />
                    <span className="truncate tabular-nums">{candidate.phone}</span>
                  </CopyableAccountField>
                </div>
              ) : <span className="block text-fg-faint">No phone</span>}
            </div>,
            candidate.deleted ? (
              <span className="text-xs text-fg-faint" key="linkedin">—</span>
            ) : (
              <LinkedInStatusMenu
                candidateName={candidate.name}
                changedAt={candidate.linkedinChangedAt}
                key="linkedin"
                status={candidate.linkedinStatus}
                userId={candidate.id}
              />
            ),
            candidate.deleted ? (
              <Badge key="status" tone="danger">Deleted</Badge>
            ) : (
              <ToggleCandidateAccountStatusForm active={candidate.active} candidateName={candidate.name} key="status" userId={candidate.id} />
            ),
            <CandidateRowMenu
              active={candidate.active}
              candidateName={candidate.name}
              deleted={candidate.deleted}
              key="actions"
              userId={candidate.id}
            />,
          ],
        }))}
      />
      <CopyToast />
    </div>
  );
}
