"use client";

import { UserRound, X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readCompanyApplicationsAction, type CompanyApplication } from "@/app/remote-companies/actions";
import { formatRomaniaDate } from "@/lib/romania-time";

export type CompanyDetailRole = {
  titleKey: string;
  title: string;
  places: string[];
  jobs: number;
  bids: number;
  firstSeen: string;
  lastSeen: string;
};

export type CompanyDetail = {
  companyKey: string;
  company: string;
  roles: number;
  jobs: number;
  bids: number;
  lastSeen: string;
  items: CompanyDetailRole[];
};

const OpenContext = createContext<(index: number) => void>(() => {});

// The companies on this page and the one details window they share: any cell of a row opens it.
export function CompanyDetails({ companies, searching, children }: { companies: CompanyDetail[]; searching: boolean; children: ReactNode }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const company = openIndex === null ? null : companies[openIndex] ?? null;
  return (
    <OpenContext.Provider value={setOpenIndex}>
      {children}
      {company && <CompanyDialog company={company} key={company.companyKey} onClose={() => setOpenIndex(null)} searching={searching} />}
    </OpenContext.Provider>
  );
}

/** A table cell's content as a button that opens its company's details. */
export function OpenCompany({ index, label, children, className = "" }: { index: number; label: string; children: ReactNode; className?: string }) {
  const open = useContext(OpenContext);
  return (
    <button
      aria-haspopup="dialog"
      aria-label={label}
      className={`block w-full cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
      onClick={() => open(index)}
      type="button"
    >
      {children}
    </button>
  );
}

function CompanyDialog({ company, searching, onClose }: { company: CompanyDetail; searching: boolean; onClose: () => void }) {
  const [applications, setApplications] = useState<CompanyApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    readCompanyApplicationsAction(company.companyKey)
      .then((result) => {
        if (!current) return;
        if (result.ok) setApplications(result.applications);
        else setError(result.error);
      })
      .catch(() => { if (current) setError("Who applied could not be loaded. Try again."); });
    return () => { current = false; };
  }, [company.companyKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const byRole = new Map<string, CompanyApplication[]>();
  for (const application of applications ?? []) {
    byRole.set(application.titleKey, [...(byRole.get(application.titleKey) ?? []), application]);
  }
  const titleId = `remote-company-${company.companyKey.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl ring-1 ring-line">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-fg" id={titleId}>{company.company}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {company.roles} remote {company.roles === 1 ? "role" : "roles"} · Applied {company.bids} · Saved {company.jobs} · last seen {formatRomaniaDate(company.lastSeen)}
              {searching && " · only roles matching your search"}
            </p>
          </div>
          <button aria-label="Close" autoFocus className="flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-subtle hover:text-fg" onClick={onClose} type="button">
            <X className="size-4" />
          </button>
        </header>
        <ul className="divide-y divide-line-soft overflow-y-auto px-5 py-2">
          {company.items.map((role, index) => (
            <li className="py-3" key={`${role.titleKey}-${index}`}>
              <p className="text-sm font-semibold text-fg">{role.title}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {role.places.map((place) => (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success-text ring-1 ring-inset ring-success-ring" key={place}>{place}</span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-fg-muted">
                Applied {role.bids} · Saved {role.jobs} · first seen {formatRomaniaDate(role.firstSeen)} · last seen {formatRomaniaDate(role.lastSeen)}
              </p>
              <WhoApplied applications={byRole.get(role.titleKey)} error={error} loading={applications === null && !error} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// The candidates (accounts) who applied to one role, newest first.
function WhoApplied({ applications, loading, error }: { applications: CompanyApplication[] | undefined; loading: boolean; error: string | null }) {
  if (loading) return <p className="mt-2 text-xs text-fg-faint">Loading who applied…</p>;
  if (error) return <p className="mt-2 text-xs text-danger-text" role="alert">{error}</p>;
  if (!applications?.length) return <p className="mt-2 text-xs text-fg-faint">No application on record (saved only).</p>;
  return (
    <div className="mt-2 rounded-lg bg-subtle px-3 py-2 ring-1 ring-line-soft">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Applied by</p>
      <ul className="space-y-1">
        {applications.map((application, index) => (
          <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" key={`${application.appliedAt}-${index}`}>
            <UserRound aria-hidden="true" className="size-3.5 shrink-0 text-fg-faint" />
            <span className={application.candidate ? "font-medium text-fg" : "italic text-fg-muted"}>
              {application.candidate ?? (application.own ? "Candidate" : "Another Manager's candidate")}
            </span>
            {application.manager && <span className="text-fg-muted">· Manager {application.manager}</span>}
            <span className="text-fg-muted">· {formatRomaniaDate(application.appliedAt)}</span>
            {application.place && <span className="text-fg-faint">· {application.place}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
