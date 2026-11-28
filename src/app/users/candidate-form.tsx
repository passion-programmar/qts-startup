"use client";

// The candidate Add and Edit pages' forms (/users/new, /users/<id>/edit): one scrolling page with a
// section menu on the left (2026-11-28, instead of folded cards). The menu shows ✓ or how many
// fields are empty, Save stays at the top, and each job or school is one summary line until opened.
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AtSign,
  Briefcase,
  Check,
  ClipboardList,
  Copy,
  GraduationCap,
  MapPin,
  Pencil,
  Plus,
  Tags,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/app/components/loading-icon";
import { leaveCandidatePage } from "@/app/users/candidate-tab";
import { DatePicker, MonthPicker } from "@/app/components/date-picker";
import { ConfirmButton } from "@/app/components/confirm-button";
import { Count } from "@/app/ui/badge";
import { cn } from "@/app/ui/cn";
import { LINKEDIN_STATUS_STYLES } from "@/app/users/row-actions";
import { DIVERSITY_FIELDS, type DiversityFieldName } from "@/lib/diversity-options";
import { pdfTemplateLabels, pdfTemplateValues, type PdfTemplate } from "@/server/pdf/pdf-templates";
import { formatProfileMonth } from "@/server/users/profile-values";
import { labelTextColor, managerCategoryColors } from "@/server/users/manager-category-color";
import { LINKEDIN_STATUS_LABELS, LINKEDIN_STATUSES, linkedInStatusOf, type LinkedInStatus } from "@/server/users/linkedin-status";
import { createUserAction, type UserActionState, updateCandidateProfileAction } from "@/app/users/actions";
import { FormMessage, TextField } from "@/app/users/form-fields";

const initialState: UserActionState = { error: null, success: null };

type CategoryOption = { id: string; name: string; color?: string | null; isDefault?: boolean };

/** The chosen category; "" = the default category. */
function categoryOf(categories: CategoryOption[], id: string): CategoryOption | undefined {
  return id ? categories.find((item) => item.id === id) : categories.find((item) => item.isDefault);
}

export type CandidateProfileValues = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  birthday: string | null;
  pdfTemplate: PdfTemplate;
  candidateEmail: string | null;
  phone: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  country: string | null;
  city: string | null;
  province: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  managerCategory: string;
  managerCategoryColor: string | null;
  linkedinStatus?: string | null;
  workAuthorization: string | null;
  needsSponsorship: boolean | null;
  noticePeriod: string | null;
  salaryExpectationAmount: number | null;
  salaryExpectationCurrency: string | null;
  salaryExpectationPeriod: string | null;
  yearsOfExperience: number | null;
  willingToRelocate: boolean | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  eeoPreference: string;
  nationality: string | null;
  workCountries: string | null;
  workPermitExpiry: string | null;
  languages: string | null;
  contractType: string | null;
  workHours: string | null;
  workMode: string | null;
  applicationNotes: string | null;
  gender: string | null;
  ethnicity: string | null;
  veteranStatus: string | null;
  disabilityStatus: string | null;
  sexualOrientation: string | null;
  pronouns: string | null;
  education: {
    institution: string;
    degree: string | null;
    fieldOfStudy: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string | null;
  }[];
  experience: {
    companyName: string;
    jobTitle: string;
    location: string | null;
    workMode: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string | null;
  }[];
};

// Whether the form was changed (typing, picking, or the calendar and "Add" buttons), so Cancel can ask first.
function useChangeTracking() {
  const changedRef = useRef(false);
  const mark = useCallback(() => { changedRef.current = true; }, []);
  const markOnClick = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("[data-changes-form]")) changedRef.current = true;
  }, []);
  return { changedRef, handlers: { onChangeCapture: mark, onInputCapture: mark, onClickCapture: markOnClick } };
}

// Save, Cancel (and Copy profile on Edit) under the section menu, in view with it while scrolling; on a
// narrow screen a bar fixed to the bottom (2026-11-28). A save error shows with them, never out of sight.
function CandidateActions({
  changedRef,
  isPending,
  readOnly = false,
  submitLabel,
  pendingLabel,
  error,
  extra,
}: {
  changedRef: { current: boolean };
  isPending: boolean;
  readOnly?: boolean;
  submitLabel: string;
  pendingLabel: string;
  error: string | null;
  extra?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-line bg-card/95 px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(15,23,42,0.3)] backdrop-blur lg:static lg:bg-transparent lg:p-3 lg:shadow-none lg:backdrop-blur-none">
      {error ? <FormMessage variant="error">{error}</FormMessage> : null}
      <div className="flex gap-2">
        <button
          className={cn(
            "inline-flex h-10 items-center justify-center rounded-lg border border-line px-4 text-sm font-medium text-fg-soft transition hover:bg-line-soft",
            readOnly ? "flex-1" : "flex-none",
          )}
          onClick={() => {
            if (changedRef.current && !window.confirm("Discard unsaved changes? You changed this form but have not saved it.")) return;
            leaveCandidatePage(router, false);
          }}
          type="button"
        >
          {readOnly ? "Back" : "Cancel"}
        </button>
        {!readOnly && (
          <button
            className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
            disabled={isPending}
            type="submit"
          >
            {isPending ? <LoadingIcon className="size-4" /> : null}
            <span className="truncate">{isPending ? pendingLabel : submitLabel}</span>
          </button>
        )}
      </div>
      {extra ? <div className="flex">{extra}</div> : null}
    </div>
  );
}

// The Add candidate page's form (opened in its own tab from the list). A saved candidate closes the tab
// or goes back to the list, where the new row appears.
// Next keeps a left page alive (Activity), so each save gives the next visit a fresh, empty form.
export function CandidateCreateForm({ categories = [] }: { categories?: CategoryOption[] }) {
  const [formKey, setFormKey] = useState(0);
  return <CandidateCreateFormFields categories={categories} key={formKey} onCreated={() => setFormKey((key) => key + 1)} />;
}

function CandidateCreateFormFields({ categories, onCreated }: { categories: CategoryOption[]; onCreated: () => void }) {
  const router = useRouter();
  const { changedRef, handlers: changeHandlers } = useChangeTracking();
  const [state, formAction, isPending] = useActionState(
    async (previous: UserActionState, formData: FormData) => {
      const result = await createUserAction(previous, formData);
      // A new candidate closes its tab (or goes back to the list), and the list shows the new row.
      if (result.success) {
        changedRef.current = false;
        leaveCandidatePage(router, true);
        onCreated();
      }
      return result;
    },
    initialState,
  );

  return (
    <form action={formAction} {...changeHandlers}>
      <CandidateFormBody
        actions={
          <CandidateActions
            changedRef={changedRef}
            error={state.error}
            isPending={isPending}
            pendingLabel="Creating..."
            submitLabel="Create candidate"
          />
        }
        categories={categories}
      />
    </form>
  );
}

// The Edit candidate page's form. A deleted candidate's profile is shown read-only.
export function CandidateEditForm({
  candidate,
  categories = [],
  readOnly = false,
}: {
  candidate: CandidateProfileValues;
  categories?: CategoryOption[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { changedRef, handlers: changeHandlers } = useChangeTracking();
  const [state, formAction, isPending] = useActionState(
    async (previous: UserActionState, formData: FormData) => {
      const result = await updateCandidateProfileAction(previous, formData);
      // A saved profile closes its tab (or goes back to the list), and the list shows the change.
      if (result.success) {
        changedRef.current = false;
        leaveCandidatePage(router, true);
      }
      return result;
    },
    initialState,
  );

  return (
    <form action={formAction} {...changeHandlers}>
      <input name="userId" type="hidden" value={candidate.userId} />
      <CandidateFormBody
        actions={
          <CandidateActions
            changedRef={changedRef}
            error={state.error}
            extra={<CopyProfileButton />}
            isPending={isPending}
            pendingLabel="Saving..."
            readOnly={readOnly}
            submitLabel="Save profile"
          />
        }
        candidate={candidate}
        categories={categories}
        readOnly={readOnly}
      />
    </form>
  );
}

type SectionKey = "personal" | "contact" | "address" | "organise" | "experience" | "education" | "facts" | "diversity";

// progress: "fields" counts empty fields (✓ when none), "entries" counts the entries, "none" shows nothing.
const SECTIONS: Record<SectionKey, { title: string; icon: ReactNode; progress: "fields" | "entries" | "none" }> = {
  personal: { title: "Personal", icon: <UserRound />, progress: "fields" },
  contact: { title: "Contact", icon: <AtSign />, progress: "fields" },
  address: { title: "Address", icon: <MapPin />, progress: "fields" },
  organise: { title: "Organise", icon: <Tags />, progress: "fields" },
  experience: { title: "Experience", icon: <Briefcase />, progress: "entries" },
  education: { title: "Education", icon: <GraduationCap />, progress: "entries" },
  facts: { title: "Application facts", icon: <ClipboardList />, progress: "fields" },
  diversity: { title: "Diversity answers", icon: <Users />, progress: "none" },
};

/** Ids of a history list's entries; existing entries keep their index, new ones are "fresh" and open. */
function useHistoryRows(count: number) {
  const [rows, setRows] = useState(() =>
    count ? Array.from({ length: count }, (_, id) => ({ id, fresh: false })) : [{ id: 0, fresh: true }],
  );
  return {
    rows,
    // Newest first, as the profile lists them; a new id never reuses a saved entry's index.
    add: () => setRows((current) => [{ id: Math.max(count - 1, ...current.map((row) => row.id)) + 1, fresh: true }, ...current]),
    remove: (id: number) => setRows((current) => current.filter((row) => row.id !== id)),
  };
}

// Everything inside the form: the section menu and the sections.
function CandidateFormBody({
  actions,
  candidate,
  categories,
  readOnly = false,
}: {
  actions: ReactNode;
  candidate?: CandidateProfileValues;
  categories: CategoryOption[];
  readOnly?: boolean;
}) {
  const fieldId = (field: string) => (candidate ? `${field}-${candidate.userId}` : field);
  const [managerCategoryColor, setManagerCategoryColor] = useState(candidate?.managerCategoryColor ?? "");
  // The chosen category; the Edit page's empty choice keeps the current one, the Add page's is the default.
  const [pickedCategory, setPickedCategory] = useState(candidate?.categoryId ?? "");
  const lockedCategory = categoryOf(categories, pickedCategory);
  // A category with a Super Admin colour decides the label colour; the Manager picks only otherwise.
  const lockedColor = lockedCategory?.color || null;
  const labelColor = lockedColor ?? managerCategoryColor;
  const experienceCount = candidate?.experience.length ?? 0;
  const educationCount = candidate?.education.length ?? 0;
  const experience = useHistoryRows(experienceCount);
  const education = useHistoryRows(educationCount);
  const sectionKeys: SectionKey[] = ["personal", "contact", "address", "organise", "experience", "education", "facts", "diversity"];
  const panel = useRef<HTMLFieldSetElement>(null);
  const progress = useSectionProgress(panel);
  const active = useActiveSection(panel);

  return (
    // Bottom room on a narrow screen, so the fixed button bar never covers the last fields.
    <div className="pb-24 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:pb-0">
      <div className="lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:divide-y lg:divide-line lg:rounded-card lg:border lg:border-line lg:bg-card lg:shadow-sm">
        <SectionMenu active={active} keys={sectionKeys} progress={progress} />
        {actions}
      </div>
      <fieldset
        className="min-w-0 divide-y divide-line overflow-hidden rounded-card border border-line bg-card shadow-sm"
        disabled={readOnly}
        ref={panel}
      >
        <FormSection copy sectionKey="personal">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <TextField autoComplete="given-name" defaultValue={candidate?.firstName ?? ""} id={fieldId("firstName")} label="First name" maxLength={120} name="firstName" required />
            <TextField autoComplete="family-name" defaultValue={candidate?.lastName ?? ""} id={fieldId("lastName")} label="Last name" maxLength={120} name="lastName" required />
            <DatePicker defaultValue={candidate?.birthday ?? ""} id={fieldId("birthday")} label="Birthday (optional)" name="birthday" />
            <div className="sm:col-span-2 xl:col-span-3">
              <TextField autoComplete="organization-title" defaultValue={candidate?.headline ?? ""} id={fieldId("headline")} label="Professional headline" maxLength={256} name="headline" />
            </div>
          </div>
        </FormSection>

        <FormSection copy sectionKey="contact">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <TextField autoComplete="email" defaultValue={candidate?.candidateEmail ?? ""} id={fieldId("candidateEmail")} label={candidate ? "Candidate email" : "Candidate email (optional)"} maxLength={320} name="candidateEmail" type="email" />
            <TextField autoComplete="tel" defaultValue={candidate?.phone ?? ""} id={fieldId("phone")} label="Phone" maxLength={64} name="phone" placeholder="+1 (555) 123-4567" type="tel" />
            <TextField autoComplete="url" defaultValue={candidate?.linkedinUrl ?? ""} id={fieldId("linkedinUrl")} label="LinkedIn profile" maxLength={2048} name="linkedinUrl" placeholder="linkedin.com/in/username" type="text" />
          </div>
        </FormSection>

        <FormSection copy sectionKey="address">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <TextField autoComplete="country" defaultValue={candidate?.country ?? ""} id={fieldId("country")} label="Country" maxLength={120} name="country" placeholder="Country name" />
            <TextField autoComplete="address-level2" defaultValue={candidate?.city ?? ""} id={fieldId("city")} label="City" maxLength={120} name="city" />
            <TextField autoComplete="address-level1" defaultValue={candidate?.province ?? ""} id={fieldId("province")} label="Province / state" maxLength={120} name="province" />
            <div className="sm:col-span-2">
              <TextField autoComplete="street-address" defaultValue={candidate?.addressLine1 ?? ""} id={fieldId("addressLine1")} label="Address line 1" maxLength={256} name="addressLine1" />
            </div>
            <TextField autoComplete="postal-code" defaultValue={candidate?.postalCode ?? ""} id={fieldId("postalCode")} label="Postal code" maxLength={32} name="postalCode" />
          </div>
        </FormSection>

        <FormSection sectionKey="organise">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <CandidateCategoryField
              categories={categories}
              id={fieldId("candidateCategoryId")}
              name={candidate?.categoryName}
              onChange={(id) => setPickedCategory(id || (candidate?.categoryId ?? ""))}
              value={candidate?.categoryId}
            />
            <TextField
              autoComplete="off"
              defaultValue={candidate?.managerCategory || ""}
              id={fieldId("managerCategory")}
              label="Label (optional)"
              maxLength={80}
              name="managerCategory"
              placeholder="Your own label, e.g. AI / ML"
              style={{ backgroundColor: labelColor || undefined, color: labelColor ? labelTextColor(labelColor) : undefined }}
            />
            <PdfTemplateField defaultValue={candidate?.pdfTemplate} id={fieldId("pdfTemplate")} />
            <div className="sm:col-span-2 xl:col-span-3">
              {lockedColor ? (
                <CategoryColorNote categoryName={lockedCategory?.name ?? "this category"} color={lockedColor} />
              ) : (
                <ManagerCategoryColorField id={fieldId("managerCategoryColor")} onChange={setManagerCategoryColor} value={managerCategoryColor} />
              )}
            </div>
            <div className="sm:col-span-2 xl:col-span-3">
              <LinkedInStatusField value={candidate?.linkedinStatus} />
            </div>
          </div>
        </FormSection>

        <FormSection
          actions={<AddEntryButton disabled={readOnly || experience.rows.length >= 20} onClick={experience.add}>Add job</AddEntryButton>}
          copy
          sectionKey="experience"
        >
          <div className="space-y-2">
            {experience.rows.map((row, index) => {
              const entry = row.id < experienceCount ? candidate?.experience[row.id] : undefined;
              return (
                <HistoryEntry
                  defaultOpen={readOnly || row.fresh}
                  focusOnMount={row.fresh && row.id >= Math.max(1, experienceCount)}
                  index={index}
                  initialSummary={entry ? experienceSummary(entry.jobTitle, entry.companyName, formatProfileMonth(entry.startDate), formatProfileMonth(entry.endDate), entry.isCurrent, entry.location ?? "") : null}
                  key={row.id}
                  kind="experience"
                  onRemove={() => experience.remove(row.id)}
                  readOnly={readOnly}
                >
                  <TextField autoComplete="organization-title" defaultValue={entry?.jobTitle ?? ""} id={fieldId(`experienceJobTitle-${row.id}`)} label="Job title" maxLength={160} name="experienceJobTitle" />
                  <TextField autoComplete="organization" defaultValue={entry?.companyName ?? ""} id={fieldId(`experienceCompanyName-${row.id}`)} label="Employer" maxLength={160} name="experienceCompanyName" />
                  <TextField autoComplete="off" defaultValue={entry?.location ?? ""} id={fieldId(`experienceLocation-${row.id}`)} label="Location (optional)" maxLength={160} name="experienceLocation" />
                  <WorkModeField defaultValue={entry?.workMode ?? ""} id={fieldId(`experienceWorkMode-${row.id}`)} />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.startDate ?? null)} id={fieldId(`experienceStartDate-${row.id}`)} label="Start month" name="experienceStartDate" />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.endDate ?? null)} id={fieldId(`experienceEndDate-${row.id}`)} label="End month" name="experienceEndDate" />
                  <CurrentStatusCheckbox defaultChecked={entry?.isCurrent ?? false} id={fieldId(`experienceIsCurrent-${row.id}`)} label="Currently working here?" name="experienceIsCurrent" />
                  <TextAreaField className="sm:col-span-2 xl:col-span-3" defaultValue={entry?.description ?? ""} id={fieldId(`experienceDescription-${row.id}`)} label="Responsibilities / achievements (optional)" maxLength={5000} name="experienceDescription" />
                </HistoryEntry>
              );
            })}
          </div>
        </FormSection>

        <FormSection
          actions={<AddEntryButton disabled={readOnly || education.rows.length >= 20} onClick={education.add}>Add education</AddEntryButton>}
          copy
          sectionKey="education"
        >
          <div className="space-y-2">
            {education.rows.map((row, index) => {
              const entry = row.id < educationCount ? candidate?.education[row.id] : undefined;
              return (
                <HistoryEntry
                  defaultOpen={readOnly || row.fresh}
                  focusOnMount={row.fresh && row.id >= Math.max(1, educationCount)}
                  index={index}
                  initialSummary={entry ? educationSummary(entry.degree ?? "", entry.fieldOfStudy ?? "", entry.institution, formatProfileMonth(entry.startDate), formatProfileMonth(entry.endDate)) : null}
                  key={row.id}
                  kind="education"
                  onRemove={() => education.remove(row.id)}
                  readOnly={readOnly}
                >
                  <TextField autoComplete="off" defaultValue={entry?.institution ?? ""} id={fieldId(`educationInstitution-${row.id}`)} label="Institution" maxLength={120} name="educationInstitution" />
                  <TextField autoComplete="off" defaultValue={entry?.degree ?? ""} id={fieldId(`educationDegree-${row.id}`)} label="Degree / credential" maxLength={120} name="educationDegree" />
                  <TextField autoComplete="off" defaultValue={entry?.fieldOfStudy ?? ""} id={fieldId(`educationFieldOfStudy-${row.id}`)} label="Field of study" maxLength={120} name="educationFieldOfStudy" />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.startDate ?? null)} id={fieldId(`educationStartDate-${row.id}`)} label="Start month" name="educationStartDate" />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.endDate ?? null)} id={fieldId(`educationEndDate-${row.id}`)} label="End month" name="educationEndDate" />
                  <input name="educationIsCurrent" type="hidden" value="false" />
                  <TextAreaField className="sm:col-span-2 xl:col-span-3" defaultValue={entry?.description ?? ""} id={fieldId(`educationDescription-${row.id}`)} label="Description (optional)" maxLength={5000} name="educationDescription" />
                </HistoryEntry>
              );
            })}
          </div>
        </FormSection>

        <ApplicationFactsSection candidate={candidate} fieldId={fieldId} />
        <DiversitySection candidate={candidate} fieldId={fieldId} />
      </fieldset>
    </div>
  );
}

/** Empty fields per "fields" section and entries per "entries" section, kept current as the form changes. */
function useSectionProgress(panel: RefObject<HTMLElement | null>): Partial<Record<SectionKey, number>> {
  const [progress, setProgress] = useState<Partial<Record<SectionKey, number>>>({});
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      // After the click or typing has been drawn (a calendar pick updates its box a moment later).
      frame = requestAnimationFrame(() => {
        const next: Partial<Record<SectionKey, number>> = {};
        root.querySelectorAll<HTMLElement>("section[data-section]").forEach((section) => {
          const key = section.dataset.section as SectionKey;
          const kind = SECTIONS[key]?.progress;
          if (kind === "entries") next[key] = section.querySelectorAll("[data-history-entry]").length;
          else if (kind === "fields") next[key] = emptyFieldCount(section);
        });
        setProgress((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      });
    };
    measure();
    root.addEventListener("input", measure, true);
    root.addEventListener("change", measure, true);
    root.addEventListener("click", measure, true);
    const observer = new MutationObserver(measure);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("input", measure, true);
      root.removeEventListener("change", measure, true);
      root.removeEventListener("click", measure, true);
      observer.disconnect();
    };
  }, [panel]);
  return progress;
}

// Fields a person fills in, left empty; "(optional)" ones do not count.
function emptyFieldCount(section: HTMLElement): number {
  let empty = 0;
  section
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input[id]:not([type=hidden]):not([type=checkbox]):not([type=radio]), select[id], textarea[id]",
    )
    .forEach((field) => {
      if (field.dataset.progressSkip !== undefined) return;
      if (/\(optional\)/i.test(field.labels?.[0]?.textContent ?? "")) return;
      if (!field.value.trim()) empty += 1;
    });
  return empty;
}

/** The section in view, for the menu's highlight. */
function useActiveSection(panel: RefObject<HTMLElement | null>): SectionKey {
  const [active, setActive] = useState<SectionKey>("personal");
  useEffect(() => {
    const root = panel.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActive((visible[0].target as HTMLElement).dataset.section as SectionKey);
      },
      // A band a little below the sticky bars: the section crossing it is the one being read.
      { rootMargin: "-25% 0px -65% 0px" },
    );
    root.querySelectorAll("section[data-section]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [panel]);
  return active;
}

function SectionMenu({ keys, active, progress }: { keys: SectionKey[]; active: SectionKey; progress: Partial<Record<SectionKey, number>> }) {
  return (
    <nav
      aria-label="Form sections"
      className="mb-4 flex gap-1 overflow-x-auto rounded-card border border-line bg-card p-1 shadow-sm lg:mb-0 lg:flex-col lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-2 lg:shadow-none"
    >
      {keys.map((key) => {
        const section = SECTIONS[key];
        const count = progress[key];
        return (
          <a
            aria-current={active === key ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium transition-colors [&>svg]:size-4 [&>svg]:shrink-0",
              active === key ? "bg-primary-soft text-primary-text" : "text-fg-muted hover:bg-line-soft hover:text-fg",
            )}
            href={`#section-${key}`}
            key={key}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {section.icon}
            <span className="flex-1 whitespace-nowrap">{section.title}</span>
            {count === undefined ? null : section.progress === "entries" ? (
              <Count value={count} />
            ) : count === 0 ? (
              <Check aria-label="complete" className="text-success" />
            ) : (
              <span className="whitespace-nowrap text-[11px] font-semibold text-warning-text">{count} empty</span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

// One part of the form, always open; "copy" puts it in the Copy profile text.
function FormSection({ sectionKey, actions, copy = false, children }: { sectionKey: SectionKey; actions?: ReactNode; copy?: boolean; children: ReactNode }) {
  const section = SECTIONS[sectionKey];
  return (
    <section
      aria-labelledby={`section-${sectionKey}-title`}
      className="scroll-mt-[calc(var(--header-height)+1.5rem)] px-5 py-6 sm:px-6"
      data-copy-section={copy ? section.title : undefined}
      data-section={sectionKey}
      id={`section-${sectionKey}`}
    >
      <div className="mb-5 flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text [&>svg]:size-4">{section.icon}</span>
        <h2 className="flex-1 text-base font-semibold text-fg" id={`section-${sectionKey}-title`}>{section.title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function AddEntryButton({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-ring bg-primary-soft px-3 text-xs font-semibold text-primary-text transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
      data-changes-form
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Plus className="size-3.5" />
      {children}
    </button>
  );
}

type EntrySummary = { title: string; detail: string };

/** "Jan 2021" from the form's "01/2021"; anything else as typed. */
function monthText(value: string): string {
  const match = /^(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return value.trim();
  return new Date(Number(match[2]), Number(match[1]) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function dateRange(start: string, end: string, current: boolean): string {
  const from = monthText(start);
  const to = current ? "now" : monthText(end);
  return from || to ? `${from || "?"} – ${to || "?"}` : "";
}

function experienceSummary(jobTitle: string, company: string, start: string, end: string, current: boolean, location: string): EntrySummary {
  return {
    title: jobTitle.trim() || "New job",
    detail: [company.trim(), dateRange(start, end, current), location.trim()].filter(Boolean).join(" · "),
  };
}

function educationSummary(degree: string, field: string, institution: string, start: string, end: string): EntrySummary {
  const title = [degree.trim(), field.trim()].filter(Boolean).join(", ");
  return {
    title: title || institution.trim() || "New education",
    detail: [title ? institution.trim() : "", dateRange(start, end, false)].filter(Boolean).join(" · "),
  };
}

// The entry's summary from what its fields hold now (unsaved typing included).
function readEntrySummary(root: HTMLElement, kind: "experience" | "education"): EntrySummary {
  const value = (name: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]:not([type=hidden])`)?.value ?? "";
  if (kind === "experience") {
    const current = root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false;
    return experienceSummary(value("experienceJobTitle"), value("experienceCompanyName"), value("experienceStartDate"), value("experienceEndDate"), current, value("experienceLocation"));
  }
  return educationSummary(value("educationDegree"), value("educationFieldOfStudy"), value("educationInstitution"), value("educationStartDate"), value("educationEndDate"));
}

/**
 * One job or school: a summary line ("Title · Company · Jan 2021 – now") with Edit and Remove; Edit
 * opens its fields under it. Closed fields are still sent with the form.
 */
function HistoryEntry({
  kind,
  index,
  defaultOpen,
  focusOnMount,
  initialSummary,
  readOnly,
  onRemove,
  children,
}: {
  kind: "experience" | "education";
  index: number;
  defaultOpen: boolean;
  focusOnMount: boolean;
  initialSummary: EntrySummary | null;
  readOnly: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [summary, setSummary] = useState<EntrySummary>(
    initialSummary ?? { title: kind === "experience" ? "New job" : "New education", detail: "" },
  );
  const root = useRef<HTMLDivElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const noun = kind === "experience" ? "job" : "education entry";

  useEffect(() => {
    if (focusOnMount) fields.current?.querySelector<HTMLElement>("input:not([type=hidden])")?.focus();
  }, [focusOnMount]);

  const refreshSummary = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (root.current) setSummary(readEntrySummary(root.current, kind));
    });
  };

  return (
    <div
      className={cn("rounded-xl border transition-colors", open ? "border-primary-ring bg-subtle" : "border-line hover:border-slate-300")}
      data-history-entry=""
      onChangeCapture={refreshSummary}
      onClickCapture={refreshSummary}
      onInputCapture={refreshSummary}
      onInvalidCapture={() => {
        // A field to fix sits in a closed entry: show it at once so the browser can point at it.
        if (fields.current) fields.current.hidden = false;
        setOpen(true);
      }}
      ref={root}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{summary.title}</p>
          {summary.detail ? <p className="truncate text-xs text-fg-muted">{summary.detail}</p> : null}
        </div>
        {readOnly ? null : (
          <>
            <button
              aria-expanded={open}
              aria-label={open ? `Close ${noun} ${index + 1}` : `Edit ${noun} ${index + 1}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-fg-muted transition hover:bg-line-soft hover:text-fg"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              {open ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
              {open ? "Done" : "Edit"}
            </button>
            <ConfirmButton
              ariaLabel={`Remove ${noun} ${index + 1}`}
              className="inline-flex size-8 items-center justify-center rounded-lg text-fg-faint transition hover:bg-danger-soft hover:text-danger-text"
              cancelLabel="No"
              confirmLabel="Yes, remove"
              description={
                <>
                  <span className="block font-semibold text-fg">{summary.title}</span>
                  {summary.detail ? <span className="block">{summary.detail}</span> : null}
                  <span className="mt-3 block">It is removed from this profile when you save. Until then, Cancel on the page keeps it.</span>
                </>
              }
              onConfirm={() => {
                onRemove();
                // The dialog sits outside the form, so the change is reported from here.
                root.current?.closest("form")?.dispatchEvent(new Event("input", { bubbles: true }));
              }}
              title={`Remove this ${noun}?`}
            >
              <Trash2 className="size-4" />
            </ConfirmButton>
          </>
        )}
      </div>
      <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2 xl:grid-cols-3" hidden={!open} ref={fields}>
        {children}
      </div>
    </div>
  );
}

/**
 * "Label: value" lines for the filled fields under root, as the form shows them now (unsaved edits
 * included). Selects give their option text; a ticked checkbox gives "Yes", an empty field nothing.
 * QTS settings (PDF template, category) are not profile content and are left out.
 */
function filledFieldLines(root: ParentNode): string[] {
  const lines: string[] = [];
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id], select[id], textarea[id]").forEach((field) => {
    if (field.name === "pdfTemplate" || field.name === "managerCategory" || field.name === "candidateCategoryId") return;
    const label = field.labels?.[0]?.textContent?.replace(/\s*\(optional\)\s*$/i, "").replace(/\?$/, "").trim();
    if (!label) return;
    let value = "";
    if (field instanceof HTMLSelectElement) value = field.value ? field.selectedOptions[0]?.textContent?.trim() ?? "" : "";
    else if (field instanceof HTMLInputElement && field.type === "checkbox") value = field.checked ? "Yes" : "";
    else value = field.value.trim();
    if (value) lines.push(`${label}: ${value}`);
  });
  return lines;
}

// One section as plain text under its title; each job or school gets its own block.
function copySectionText(section: HTMLElement): string {
  const title = section.dataset.copySection ?? "";
  const entries = [...section.querySelectorAll<HTMLElement>("[data-history-entry]")];
  const body = entries.length
    ? entries
        .map((entry) => filledFieldLines(entry))
        .filter((lines) => lines.length)
        .map((lines, index) => [`${title} ${index + 1}`, ...lines].join("\n"))
        .join("\n\n")
    : filledFieldLines(section).join("\n");
  return body ? `${title}\n\n${body}` : "";
}

// Copies the whole profile (Personal, Contact, Address, Experience, Education) as plain text in one go.
function CopyProfileButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-fg-muted transition hover:bg-line-soft hover:text-fg"
      onClick={(event) => {
        const form = event.currentTarget.closest("form");
        if (!form) return;
        const text = [...form.querySelectorAll<HTMLElement>("[data-copy-section]")]
          .map(copySectionText)
          .filter(Boolean)
          .join("\n\n\n");
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      title="Copy personal, contact, address, experience and education as text"
      type="button"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy profile"}
    </button>
  );
}

// The label colour when the category has one (set by Super Admin): shown, not picked.
function CategoryColorNote({ color, categoryName }: { color: string; categoryName: string }) {
  return (
    <div className="space-y-2">
      <p className="block text-xs font-semibold text-slate-700">Label color</p>
      <input name="managerCategoryColor" type="hidden" value={color} />
      <p className="flex items-center gap-2 text-xs text-fg-muted">
        <span aria-hidden="true" className="size-5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />
        From the {categoryName} category
      </p>
    </div>
  );
}

function ManagerCategoryColorField({
  id = "managerCategoryColor",
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const labelId = `${id}-label`;
  const choices = [{ name: "Default color", value: "" }, ...managerCategoryColors];

  return (
    <div className="space-y-2">
      <p className="block text-xs font-semibold text-slate-700" id={labelId}>
        Label color
      </p>
      <input name="managerCategoryColor" type="hidden" value={value} />
      <div aria-labelledby={labelId} className="flex flex-wrap gap-1.5" role="group">
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <button
              aria-pressed={selected}
              aria-label={choice.name}
              className={`flex size-7 items-center justify-center rounded-full border bg-white p-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${selected ? "border-indigo-700 ring-2 ring-indigo-200" : "border-slate-300 hover:ring-2 hover:ring-slate-200"}`}
              key={choice.value || "none"}
              onClick={() => onChange(choice.value)}
              style={choice.value ? { backgroundColor: choice.value } : undefined}
              title={choice.name}
              type="button"
            >
              {!choice.value && <X aria-hidden="true" className="size-3 text-slate-400" />}
              {choice.value && selected ? <Check aria-hidden="true" className="size-3.5" style={{ color: labelTextColor(choice.value) }} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const selectClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

// How the candidate worked in this job; shown next to the location on generated resumes.
function WorkModeField({ id, defaultValue = "" }: { id: string; defaultValue?: string }) {
  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        Work mode (optional)
      </label>
      <select className={selectClass} defaultValue={defaultValue} id={id} name="experienceWorkMode">
        <option value="">Not set</option>
        <option value="remote">Remote</option>
        <option value="hybrid">Hybrid</option>
        <option value="onsite">Onsite</option>
      </select>
    </div>
  );
}

/**
 * Whole years from the oldest experience start month (YYYY-MM) until today, with that month; the
 * same count QTS sends to Apply. Null without any start month.
 */
function yearsOfExperience(startMonths: (string | null)[]): { years: number; since: string } | null {
  const oldest = startMonths.filter((month): month is string => Boolean(month && /^\d{4}-\d{2}/.test(month))).sort()[0];
  if (!oldest) return null;
  const [year, month] = oldest.split("-").map(Number);
  const today = new Date();
  const months = (today.getFullYear() - year) * 12 + (today.getMonth() + 1 - month);
  const since = new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return { years: Math.max(0, Math.floor(months / 12)), since };
}

// The candidate's static facts application forms ask for; Apply fills them exactly. On the Add page
// (no candidate yet) the years of experience are worked out after saving.
function ApplicationFactsSection({
  candidate,
  fieldId,
}: {
  candidate?: CandidateProfileValues;
  fieldId: (field: string) => string;
}) {
  const experience = yearsOfExperience((candidate?.experience ?? []).map((entry) => entry.startDate));
  return (
    <FormSection sectionKey="facts">
      <input name="applicationFacts" type="hidden" value="1" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <TextField autoComplete="off" defaultValue={candidate?.nationality ?? ""} id={fieldId("nationality")} label="Nationality" maxLength={100} name="nationality" placeholder="Polish" />
        <TextField autoComplete="off" defaultValue={candidate ? candidate.languages ?? "" : NEW_CANDIDATE_LANGUAGES} id={fieldId("languages")} label="Languages and levels" maxLength={300} name="languages" placeholder="English C1, Polish C2" />
        <div title="Calculated from the oldest experience start month until today.">
          <p className="mb-2 block text-xs font-semibold text-slate-700">Years of experience</p>
          <p className="flex h-10 items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 text-xs text-slate-700">
            {experience
              ? `${experience.years} ${experience.years === 1 ? "year" : "years"} · since ${experience.since}`
              : candidate ? "Add experience with a start month" : "Worked out from Experience after saving"}
          </p>
        </div>
        <TextField autoComplete="url" defaultValue={candidate?.githubUrl ?? ""} id={fieldId("githubUrl")} label="GitHub (optional)" maxLength={2048} name="githubUrl" placeholder="github.com/username" />
        <TextField autoComplete="url" defaultValue={candidate?.portfolioUrl ?? ""} id={fieldId("portfolioUrl")} label="Portfolio or website (optional)" maxLength={2048} name="portfolioUrl" />
      </div>
    </FormSection>
  );
}

// What a new candidate's form starts with (user, 2026-11-28); every value can be changed before saving.
// Gender and nationality start empty.
const NEW_CANDIDATE_LANGUAGES = "English C2";
const NEW_CANDIDATE_DIVERSITY: Partial<Record<DiversityFieldName, string>> = {
  ethnicity: "white",
  veteranStatus: "not_veteran",
  disabilityStatus: "no",
  sexualOrientation: "heterosexual",
  pronouns: "he_him",
};

// The candidate's own answers to diversity questions. Not set: Apply picks the form's decline option.
function DiversitySection({
  candidate,
  fieldId,
}: {
  candidate?: CandidateProfileValues;
  fieldId: (field: string) => string;
}) {
  return (
    <FormSection sectionKey="diversity">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DIVERSITY_FIELDS.map((field) => (
          <div key={field.name}>
            <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={fieldId(field.name)}>
              {field.label}
            </label>
            <select
              className={selectClass}
              defaultValue={candidate ? candidate[field.name] ?? "" : NEW_CANDIDATE_DIVERSITY[field.name] ?? ""}
              id={fieldId(field.name)}
              name={field.name}
              title="Not set: Apply picks the form's decline option"
            >
              <option value="">Not set</option>
              {field.options.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </FormSection>
  );
}

function CurrentStatusCheckbox({
  id,
  label,
  name,
  defaultChecked = false,
}: {
  id: string;
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="flex min-h-10 items-center gap-2 self-end">
      <input name={name} type="hidden" value={checked ? "true" : "false"} />
      <input
        checked={checked}
        className="size-4 accent-indigo-600"
        id={id}
        onChange={(event) => setChecked(event.target.checked)}
        type="checkbox"
      />
      <label
        className="text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
    </div>
  );
}

function PdfTemplateField({
  id,
  defaultValue = "qts-standard",
}: {
  id: string;
  defaultValue?: PdfTemplate;
}) {
  const isActiveTemplate = pdfTemplateValues.some((template) => template === defaultValue);

  return (
    <div>
      <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={id}>
        Résumé PDF template
      </label>
      <select className={selectClass} defaultValue={defaultValue} id={id} name="pdfTemplate">
        {pdfTemplateValues.map((template) => (
          <option key={template} value={template}>
            {pdfTemplateLabels[template]}
          </option>
        ))}
        {!isActiveTemplate && (
          <option value={defaultValue}>{pdfTemplateLabels[defaultValue]} (saved template)</option>
        )}
      </select>
    </div>
  );
}

function TextAreaField({
  id,
  label,
  name,
  maxLength,
  className,
  defaultValue,
}: {
  id: string;
  label: string;
  name: string;
  maxLength: number;
  className?: string;
  defaultValue?: string;
}) {
  return (
    <div className={className}>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
      <textarea
        className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        id={id}
        defaultValue={defaultValue}
        maxLength={maxLength}
        name={name}
        rows={3}
      />
    </div>
  );
}

// The LinkedIn account signal (also changed from the People list) as four buttons; a new candidate
// starts at None (user, 2026-11-28).
function LinkedInStatusField({ value }: { value?: string | null }) {
  const [current, setCurrent] = useState<LinkedInStatus>(value === undefined ? "none" : linkedInStatusOf(value));
  return (
    <fieldset>
      <legend className="mb-2 block text-xs font-semibold text-slate-700">LinkedIn status</legend>
      <div className="flex flex-wrap gap-2">
        {LINKEDIN_STATUSES.map((status) => {
          const checked = status === current;
          const style = LINKEDIN_STATUS_STYLES[status];
          return (
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                checked ? style.badge : "bg-card text-fg-muted ring-line hover:bg-line-soft hover:text-fg",
              )}
              key={status}
            >
              <input
                checked={checked}
                className="sr-only"
                name="linkedinStatus"
                onChange={() => setCurrent(status)}
                type="radio"
                value={status}
              />
              <span aria-hidden="true" className={cn("size-2 rounded-full", style.dot)} />
              {LINKEDIN_STATUS_LABELS[status]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// The global category (from the Super Admin's list); "Default category" leaves it to the default.
function CandidateCategoryField({
  categories,
  id,
  value,
  name,
  onChange,
}: {
  categories: CategoryOption[];
  id: string;
  value?: string | null;
  name?: string | null;
  onChange: (categoryId: string) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={id}>Category</label>
      {categories.length ? (
        <select className={selectClass} data-progress-skip="" defaultValue={value || ""} id={id} name="candidateCategoryId" onChange={(event) => onChange(event.target.value)}>
          <option value="">{value ? name : "Default category"}</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      ) : (
        <p className="flex h-10 items-center text-sm text-fg-soft" id={id}>{name || "Global"}</p>
      )}
    </div>
  );
}
