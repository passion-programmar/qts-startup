"use client";

// The candidate Add and Edit pages' forms (/users/new, /users/<id>/edit).
import {
  useActionState,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  Briefcase,
  Check,
  ClipboardList,
  Copy,
  GraduationCap,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { LoadingIcon } from "@/app/components/loading-icon";
import { DatePicker, MonthPicker } from "@/app/components/date-picker";
import { ConfirmButton } from "@/app/components/confirm-button";
import { FormCard, openCardOfInvalidField } from "@/app/components/form-card";
import { DIVERSITY_FIELDS } from "@/lib/diversity-options";
import { pdfTemplateLabels, pdfTemplateValues, type PdfTemplate } from "@/server/pdf/pdf-templates";
import { formatProfileMonth } from "@/server/users/profile-values";
import { labelTextColor, managerCategoryColors } from "@/server/users/manager-category-color";
import { LINKEDIN_STATUS_LABELS, LINKEDIN_STATUSES, linkedInStatusOf } from "@/server/users/linkedin-status";
import { createUserAction, type UserActionState, updateCandidateProfileAction } from "@/app/users/actions";
import { FormMessage, TextField } from "@/app/users/form-fields";

const initialState: UserActionState = { error: null, success: null };

type CategoryOption = { id: string; name: string };

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

// Cancel and Save at the bottom of the candidate Add and Edit pages; stays in view while scrolling.
function CandidatePageActions({
  changedRef,
  isPending,
  readOnly = false,
  submitLabel,
  pendingLabel,
  submitIcon,
}: {
  changedRef: { current: boolean };
  isPending: boolean;
  readOnly?: boolean;
  submitLabel: string;
  pendingLabel: string;
  submitIcon?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur sm:flex-row sm:justify-end">
      <button
        className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        onClick={() => {
          if (changedRef.current && !window.confirm("Discard unsaved changes? You changed this form but have not saved it.")) return;
          router.push("/users");
        }}
        type="button"
      >
        {readOnly ? "Back" : "Cancel"}
      </button>
      {!readOnly && (
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
          disabled={isPending}
          type="submit"
        >
          {isPending ? <LoadingIcon className="size-4" /> : submitIcon}
          {isPending ? pendingLabel : submitLabel}
        </button>
      )}
    </div>
  );
}

// The Add candidate page's form. A saved candidate goes back to the list, where the new row appears.
// Next keeps a left page alive (Activity), so each save gives the next visit a fresh, empty form.
export function CandidateCreateForm({ categories = [] }: { categories?: CategoryOption[] }) {
  const [formKey, setFormKey] = useState(0);
  return <CandidateCreateFormFields categories={categories} key={formKey} onCreated={() => setFormKey((key) => key + 1)} />;
}

function CandidateCreateFormFields({ categories, onCreated }: { categories: CategoryOption[]; onCreated: () => void }) {
  const router = useRouter();
  const [educationRows, setEducationRows] = useState([0]);
  const [experienceRows, setExperienceRows] = useState([0]);
  const [managerCategoryColor, setManagerCategoryColor] = useState("");
  const { changedRef, handlers: changeHandlers } = useChangeTracking();
  const [state, formAction, isPending] = useActionState(
    async (previous: UserActionState, formData: FormData) => {
      const result = await createUserAction(previous, formData);
      if (result.success) {
        changedRef.current = false;
        router.push("/users");
        onCreated();
      }
      return result;
    },
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3" onInvalidCapture={openCardOfInvalidField} {...changeHandlers}>
          <FormCard icon={<UserRound />} summary="Name, contacts, address, category" title="Basic information">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <TextField
              autoComplete="given-name"
              id="firstName"
              label="First name"
              maxLength={120}
              name="firstName"
              required
            />
            <TextField
              autoComplete="family-name"
              id="lastName"
              label="Last name"
              maxLength={120}
              name="lastName"
              required
            />
            <DatePicker
              id="birthday"
              label="Birthday (optional)"
              name="birthday"
            />
            <PdfTemplateField id="pdfTemplate" />
            <div className="sm:col-span-2">
              <TextField
                autoComplete="email"
                id="candidateEmail"
                label="Candidate email (optional)"
                maxLength={320}
                name="candidateEmail"
                type="email"
              />
            </div>
            <TextField
              autoComplete="tel"
              id="phone"
              label="Phone"
              maxLength={64}
              name="phone"
              placeholder="+1 (555) 123-4567"
              type="tel"
            />
            <div className="sm:col-span-2 xl:col-span-3">
              <TextField
                autoComplete="organization-title"
                id="headline"
                label="Professional headline"
                maxLength={256}
                name="headline"
              />
            </div>
            <TextField
              autoComplete="url"
              id="linkedinUrl"
              label="LinkedIn profile (linkedin.com/in/username)"
              maxLength={2048}
              name="linkedinUrl"
              placeholder="linkedin.com/in/username"
              type="text"
            />
            <TextField
              autoComplete="country"
              id="country"
              label="Country"
              maxLength={120}
              name="country"
              placeholder="Country name"
            />
            <TextField
              autoComplete="address-level2"
              id="city"
              label="City"
              maxLength={120}
              name="city"
            />
            <TextField
              autoComplete="address-level1"
              id="province"
              label="Province / state"
              maxLength={120}
              name="province"
            />
            <TextField
              autoComplete="street-address"
              id="addressLine1"
              label="Address line 1"
              maxLength={256}
              name="addressLine1"
            />
            <TextField
              autoComplete="postal-code"
              id="postalCode"
              label="Postal code"
              maxLength={32}
              name="postalCode"
            />
            <CandidateCategoryField categories={categories} />
            <TextField style={{ backgroundColor: managerCategoryColor || "#e2e8f0", color: labelTextColor(managerCategoryColor) }} autoComplete="off" id="managerCategory" label="Label" name="managerCategory" maxLength={80} placeholder="Your own label, e.g. AI / ML" />
            <ManagerCategoryColorField onChange={setManagerCategoryColor} value={managerCategoryColor} />
          </div>
          </FormCard>
          <HistorySection
            addRow={() =>
              setEducationRows((rows) => [Math.max(-1, ...rows) + 1, ...rows])
            }
            onRemove={(rowId) =>
              setEducationRows((rows) => rows.filter((id) => id !== rowId))
            }
            rowIds={educationRows}
            title="Education"
          >
            {(rowId) => (
              <>
                <TextField
                  autoComplete="off"
                  id={`educationInstitution-${rowId}`}
                  label="Institution"
                  maxLength={120}
                  name="educationInstitution"
                />
                <TextField
                  autoComplete="off"
                  id={`educationDegree-${rowId}`}
                  label="Degree / credential"
                  maxLength={120}
                  name="educationDegree"
                />
                <TextField
                  autoComplete="off"
                  id={`educationFieldOfStudy-${rowId}`}
                  label="Field of study"
                  maxLength={120}
                  name="educationFieldOfStudy"
                />
                <MonthPicker
                  id={`educationStartDate-${rowId}`}
                  label="Start month"
                  name="educationStartDate"
                />
                <MonthPicker
                  id={`educationEndDate-${rowId}`}
                  label="End month"
                  name="educationEndDate"
                />
                <input name="educationIsCurrent" type="hidden" value="false" />
                <TextAreaField
                  className="sm:col-span-2 xl:col-span-3"
                  id={`educationDescription-${rowId}`}
                  label="Description (optional)"
                  maxLength={5000}
                  name="educationDescription"
                />
              </>
            )}
          </HistorySection>
          <HistorySection
            addRow={() =>
              setExperienceRows((rows) => [Math.max(-1, ...rows) + 1, ...rows])
            }
            onRemove={(rowId) =>
              setExperienceRows((rows) => rows.filter((id) => id !== rowId))
            }
            rowIds={experienceRows}
            title="Experience"
          >
            {(rowId) => (
              <>
                <TextField
                  autoComplete="organization"
                  id={`experienceCompanyName-${rowId}`}
                  label="Employer"
                  maxLength={160}
                  name="experienceCompanyName"
                />
                <TextField
                  autoComplete="organization-title"
                  id={`experienceJobTitle-${rowId}`}
                  label="Job title"
                  maxLength={160}
                  name="experienceJobTitle"
                />
                <TextField
                  autoComplete="off"
                  id={`experienceLocation-${rowId}`}
                  label="Location (optional)"
                  maxLength={160}
                  name="experienceLocation"
                />
                <WorkModeField id={`experienceWorkMode-${rowId}`} />
                <MonthPicker
                  id={`experienceStartDate-${rowId}`}
                  label="Start month"
                  name="experienceStartDate"
                />
                <MonthPicker
                  id={`experienceEndDate-${rowId}`}
                  label="End month"
                  name="experienceEndDate"
                />
                <CurrentStatusCheckbox
                  id={`experienceIsCurrent-${rowId}`}
                  label="Currently working here?"
                  name="experienceIsCurrent"
                />
                <TextAreaField
                  className="sm:col-span-2 xl:col-span-3"
                  id={`experienceDescription-${rowId}`}
                  label="Responsibilities / achievements (optional)"
                  maxLength={5000}
                  name="experienceDescription"
                />
              </>
            )}
          </HistorySection>
          {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
      <CandidatePageActions
        changedRef={changedRef}
        isPending={isPending}
        pendingLabel="Creating..."
        submitIcon={<Plus className="size-4" />}
        submitLabel="Create candidate"
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
  const [managerCategoryColor, setManagerCategoryColor] = useState(candidate.managerCategoryColor ?? "");
  const [educationRows, setEducationRows] = useState(() =>
    candidate.education.length ? candidate.education.map((_, index) => index) : [0],
  );
  const [experienceRows, setExperienceRows] = useState(() =>
    candidate.experience.length ? candidate.experience.map((_, index) => index) : [0],
  );
  const nextEducationRowId = useRef(Math.max(1, candidate.education.length));
  const nextExperienceRowId = useRef(Math.max(1, candidate.experience.length));
  const { changedRef, handlers: changeHandlers } = useChangeTracking();
  const [state, formAction, isPending] = useActionState(
    async (previous: UserActionState, formData: FormData) => {
      const result = await updateCandidateProfileAction(previous, formData);
      // A saved profile goes back to the list, which shows the change.
      if (result.success) {
        changedRef.current = false;
        router.push("/users");
      }
      return result;
    },
    initialState,
  );
  const message = state;
  const fieldId = (field: string) => `${field}-${candidate.userId}`;

  return (
        <form action={formAction} className="space-y-3" onInvalidCapture={openCardOfInvalidField} {...changeHandlers}>
          <input name="userId" type="hidden" value={candidate.userId} />
          <div className="flex justify-end">
            <CopyProfileButton />
          </div>
          <fieldset className="min-w-0 space-y-3" disabled={readOnly}>
          <FormCard
            copySection="Basic information"
            icon={<UserRound />}
            summary={[[candidate.firstName, candidate.lastName].filter(Boolean).join(" "), candidate.candidateEmail, candidate.city].filter(Boolean).join(" · ") || "Name, contacts, address, category"}
            title="Basic information"
          >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            autoComplete="given-name"
            defaultValue={candidate.firstName ?? ""}
            id={fieldId("firstName")}
            label="First name"
            maxLength={120}
            name="firstName"
            required
          />
          <TextField
            autoComplete="family-name"
            defaultValue={candidate.lastName ?? ""}
            id={fieldId("lastName")}
            label="Last name"
            maxLength={120}
            name="lastName"
            required
          />
          <DatePicker
            defaultValue={candidate.birthday ?? ""}
            id={fieldId("birthday")}
            label="Birthday (optional)"
            name="birthday"
          />
          <PdfTemplateField defaultValue={candidate.pdfTemplate} id={fieldId("pdfTemplate")} />
          <TextField
            autoComplete="email"
            defaultValue={candidate.candidateEmail ?? ""}
            id={fieldId("candidateEmail")}
            label="Candidate email"
            maxLength={320}
            name="candidateEmail"
            type="email"
          />
          <TextField
            autoComplete="tel"
            defaultValue={candidate.phone ?? ""}
            id={fieldId("phone")}
            label="Phone"
            maxLength={64}
            name="phone"
            placeholder="+1 (555) 123-4567"
            type="tel"
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <TextField
              autoComplete="organization-title"
              defaultValue={candidate.headline ?? ""}
              id={fieldId("headline")}
              label="Professional headline"
              maxLength={256}
              name="headline"
            />
          </div>
          <TextField
            autoComplete="url"
            defaultValue={candidate.linkedinUrl ?? ""}
            id={fieldId("linkedinUrl")}
            label="LinkedIn profile (linkedin.com/in/username)"
            maxLength={2048}
            name="linkedinUrl"
            placeholder="linkedin.com/in/username"
            type="text"
          />
          <TextField
            autoComplete="country"
            defaultValue={candidate.country ?? ""}
            id={fieldId("country")}
            label="Country"
            maxLength={120}
            name="country"
          />
          <TextField
            autoComplete="address-level2"
            defaultValue={candidate.city ?? ""}
            id={fieldId("city")}
            label="City"
            maxLength={120}
            name="city"
          />
          <TextField
            autoComplete="address-level1"
            defaultValue={candidate.province ?? ""}
            id={fieldId("province")}
            label="Province / state"
            maxLength={120}
            name="province"
          />
          <TextField
            autoComplete="street-address"
            defaultValue={candidate.addressLine1 ?? ""}
            id={fieldId("addressLine1")}
            label="Address line 1"
            maxLength={256}
            name="addressLine1"
          />
          <TextField
            autoComplete="postal-code"
            defaultValue={candidate.postalCode ?? ""}
            id={fieldId("postalCode")}
            label="Postal code"
            maxLength={32}
            name="postalCode"
          />
          <CandidateCategoryField categories={categories} value={candidate.categoryId} name={candidate.categoryName} />
          <TextField style={{ backgroundColor: managerCategoryColor || "#e2e8f0", color: labelTextColor(managerCategoryColor) }} autoComplete="off" defaultValue={candidate.managerCategory || ""} id={fieldId("managerCategory")} label="Label" name="managerCategory" maxLength={80} placeholder="Your own label, e.g. AI / ML" />
          <ManagerCategoryColorField
            id={fieldId("managerCategoryColor")}
            onChange={setManagerCategoryColor}
            value={managerCategoryColor}
          />
          <LinkedInStatusField value={candidate.linkedinStatus} />
          </div>
          </FormCard>
          <ApplicationFactsSection candidate={candidate} fieldId={fieldId} />
          <HistorySection
            addRow={() =>
              setEducationRows((rows) => [nextEducationRowId.current++, ...rows])
            }
            onRemove={(rowId) =>
              setEducationRows((rows) => rows.filter((id) => id !== rowId))
            }
            rowIds={educationRows}
            title="Education"
          >
            {(rowId) => {
              const entry = candidate.education[rowId];
              return (
                <>
                  <TextField autoComplete="off" defaultValue={entry?.institution ?? ""} id={fieldId(`educationInstitution-${rowId}`)} label="Institution" maxLength={120} name="educationInstitution" />
                  <TextField autoComplete="off" defaultValue={entry?.degree ?? ""} id={fieldId(`educationDegree-${rowId}`)} label="Degree / credential" maxLength={120} name="educationDegree" />
                  <TextField autoComplete="off" defaultValue={entry?.fieldOfStudy ?? ""} id={fieldId(`educationFieldOfStudy-${rowId}`)} label="Field of study" maxLength={120} name="educationFieldOfStudy" />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.startDate ?? null)} id={fieldId(`educationStartDate-${rowId}`)} label="Start month" name="educationStartDate" />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.endDate ?? null)} id={fieldId(`educationEndDate-${rowId}`)} label="End month" name="educationEndDate" />
                  <input name="educationIsCurrent" type="hidden" value="false" />
                  <TextAreaField className="sm:col-span-2 xl:col-span-3" defaultValue={entry?.description ?? ""} id={fieldId(`educationDescription-${rowId}`)} label="Description (optional)" maxLength={5000} name="educationDescription" />
                </>
              );
            }}
          </HistorySection>
          <HistorySection
            addRow={() =>
              setExperienceRows((rows) => [nextExperienceRowId.current++, ...rows])
            }
            onRemove={(rowId) =>
              setExperienceRows((rows) => rows.filter((id) => id !== rowId))
            }
            rowIds={experienceRows}
            title="Experience"
          >
            {(rowId) => {
              const entry = candidate.experience[rowId];
              return (
                <>
                  <TextField autoComplete="organization" defaultValue={entry?.companyName ?? ""} id={fieldId(`experienceCompanyName-${rowId}`)} label="Employer" maxLength={160} name="experienceCompanyName" />
                  <TextField autoComplete="organization-title" defaultValue={entry?.jobTitle ?? ""} id={fieldId(`experienceJobTitle-${rowId}`)} label="Job title" maxLength={160} name="experienceJobTitle" />
                  <TextField autoComplete="off" defaultValue={entry?.location ?? ""} id={fieldId(`experienceLocation-${rowId}`)} label="Location (optional)" maxLength={160} name="experienceLocation" />
                  <WorkModeField defaultValue={entry?.workMode ?? ""} id={fieldId(`experienceWorkMode-${rowId}`)} />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.startDate ?? null)} id={fieldId(`experienceStartDate-${rowId}`)} label="Start month" name="experienceStartDate" />
                  <MonthPicker defaultValue={formatProfileMonth(entry?.endDate ?? null)} id={fieldId(`experienceEndDate-${rowId}`)} label="End month" name="experienceEndDate" />
                  <CurrentStatusCheckbox defaultChecked={entry?.isCurrent ?? false} id={fieldId(`experienceIsCurrent-${rowId}`)} label="Currently working here?" name="experienceIsCurrent" />
                  <TextAreaField className="sm:col-span-2 xl:col-span-3" defaultValue={entry?.description ?? ""} id={fieldId(`experienceDescription-${rowId}`)} label="Responsibilities / achievements (optional)" maxLength={5000} name="experienceDescription" />
                </>
              );
            }}
          </HistorySection>
          </fieldset>
          {message.error && <FormMessage variant="error">{message.error}</FormMessage>}
          <CandidatePageActions
            changedRef={changedRef}
            isPending={isPending}
            pendingLabel="Saving..."
            readOnly={readOnly}
            submitLabel="Save profile"
          />
        </form>
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
              className={`flex size-6 items-center justify-center rounded-full border bg-white p-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${selected ? "border-indigo-700 ring-2 ring-indigo-200" : "border-slate-300 hover:ring-2 hover:ring-slate-200"}`}
              key={choice.value || "none"}
              onClick={() => onChange(choice.value)}
              style={choice.value ? { backgroundColor: choice.value } : undefined}
              title={choice.name}
              type="button"
            >
              {!choice.value && <X aria-hidden="true" className="size-3 text-slate-400" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HistorySection({
  title,
  rowIds,
  addRow,
  onRemove,
  children,
}: {
  title: string;
  rowIds: number[];
  addRow: () => void;
  onRemove: (rowId: number) => void;
  children: (rowId: number) => React.ReactNode;
}) {
  // A removal is confirmed in a dialog outside the form, so it reports the change through this marker.
  const changedMarker = useRef<HTMLSpanElement>(null);
  return (
    <FormCard
      actions={
        <button
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-200 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          data-changes-form
          disabled={rowIds.length >= 20}
          onClick={addRow}
          type="button"
        >
          <Plus className="size-3.5" />
          Add {title.toLowerCase()}
        </button>
      }
      copySection={title}
      className="sm:col-span-2 xl:col-span-3"
      icon={title === "Education" ? <GraduationCap /> : <Briefcase />}
      summary={`${rowIds.length} ${rowIds.length === 1 ? "entry" : "entries"} · newest first`}
      title={title}
    >
      <span hidden ref={changedMarker} />
      {rowIds.map((rowId, index) => (
        <fieldset
          className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-3"
          key={rowId}
        >
          <legend className="px-1 text-[11px] font-semibold text-slate-600">
            {title} entry {index + 1}
          </legend>
          {children(rowId)}
          <ConfirmButton
            ariaLabel={`Remove ${title.toLowerCase()} entry ${index + 1}`}
            className="inline-flex h-9 items-center justify-center gap-2 justify-self-start rounded-lg px-3 text-[11px] font-medium text-rose-700 transition hover:bg-rose-50"
            confirmLabel="Remove entry"
            description={`Remove ${title.toLowerCase()} entry ${index + 1} from this form? It is removed from the profile when you save.`}
            onConfirm={() => {
              onRemove(rowId);
              changedMarker.current?.dispatchEvent(new Event("input", { bubbles: true }));
            }}
            title={`Remove this ${title.toLowerCase()} entry?`}
          >
            <Trash2 className="size-3.5" />
            Remove entry
          </ConfirmButton>
        </fieldset>
      ))}
    </FormCard>
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
    if (field.name === "pdfTemplate" || field.name === "managerCategory") return;
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

// One card as plain text under its title; entries of a history card each get their own block.
function copySectionText(card: HTMLElement): string {
  const title = card.dataset.copySection ?? "";
  const body = card.querySelector("fieldset > legend")
    ? [...card.querySelectorAll("fieldset")]
        .filter((entry) => entry.querySelector(":scope > legend"))
        .map((entry) => filledFieldLines(entry))
        .filter((lines) => lines.length)
        .map((lines, index) => [`${title} ${index + 1}`, ...lines].join("\n"))
        .join("\n\n")
    : filledFieldLines(card).join("\n");
  return body ? `${title}\n\n${body}` : "";
}

// Copies the whole profile (Basic information, Education, Experience) as plain text in one go.
function CopyProfileButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      onClick={(event) => {
        const form = event.currentTarget.closest("form");
        if (!form) return;
        const text = [...form.querySelectorAll<HTMLElement>("details[data-copy-section]")]
          .map(copySectionText)
          .filter(Boolean)
          .join("\n\n\n");
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      title="Copy basic information, education, and experience as text"
      type="button"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy profile"}
    </button>
  );
}

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
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={defaultValue}
        id={id}
        name="experienceWorkMode"
      >
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

// The candidate's static facts application forms ask for; Apply fills them exactly.
function ApplicationFactsSection({
  candidate,
  fieldId,
}: {
  candidate: CandidateProfileValues;
  fieldId: (field: string) => string;
}) {
  const experience = yearsOfExperience(candidate.experience.map((entry) => entry.startDate));
  return (
    <FormCard
      icon={<ClipboardList />}
      summary={[candidate.nationality, candidate.languages, experience ? `${experience.years} years of experience` : null].filter(Boolean).join(" · ") || "Nationality, languages, links"}
      title="Application facts"
    >
      <input name="applicationFacts" type="hidden" value="1" />
      <p className="text-xs text-slate-500">
        Facts about this candidate, including their own answers to diversity questions. Check saves personal corrections for this candidate and shared answers for your Manager library. Super Admin manages global answers separately.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          autoComplete="off"
          defaultValue={candidate.nationality ?? ""}
          id={fieldId("nationality")}
          label="Nationality"
          maxLength={100}
          name="nationality"
          placeholder="Polish"
        />
        <TextField
          autoComplete="off"
          defaultValue={candidate.languages ?? ""}
          id={fieldId("languages")}
          label="Languages and levels"
          maxLength={300}
          name="languages"
          placeholder="English C1, Polish C2"
        />
        <div>
          <p className="mb-2 block text-xs font-semibold text-slate-700">Years of experience</p>
          <p className="flex h-10 items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 text-xs text-slate-700">
            {experience
              ? `${experience.years} ${experience.years === 1 ? "year" : "years"} · since ${experience.since}`
              : "Add experience with a start month"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Calculated from the oldest experience start month until today.</p>
        </div>
        <TextField
          autoComplete="url"
          defaultValue={candidate.githubUrl ?? ""}
          id={fieldId("githubUrl")}
          label="GitHub (optional)"
          maxLength={2048}
          name="githubUrl"
          placeholder="github.com/username"
        />
        <TextField
          autoComplete="url"
          defaultValue={candidate.portfolioUrl ?? ""}
          id={fieldId("portfolioUrl")}
          label="Portfolio or website (optional)"
          maxLength={2048}
          name="portfolioUrl"
        />
      </div>
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div>
          <p className="text-xs font-semibold text-slate-800">Diversity answers</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Used for gender, race, veteran, disability, orientation, and pronoun questions. Not set: Apply picks the form&apos;s decline option.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DIVERSITY_FIELDS.map((field) => (
            <div key={field.name}>
              <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={fieldId(field.name)}>
                {field.label}
              </label>
              <select
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                defaultValue={candidate[field.name] ?? ""}
                id={fieldId(field.name)}
                name={field.name}
              >
                <option value="">Not set</option>
                {field.options.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </FormCard>
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
        PDF template
      </label>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={defaultValue}
        id={id}
        name="pdfTemplate"
      >
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
        className="min-h-20 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        id={id}
        defaultValue={defaultValue}
        maxLength={maxLength}
        name={name}
        rows={3}
      />
    </div>
  );
}

// The LinkedIn account signal (also changed from the People list): Live, Applying or Blocked.
function LinkedInStatusField({ value }: { value?: string | null }) {
  return <label className="block space-y-2 text-xs font-semibold text-slate-700">LinkedIn status
    <select className="block w-full rounded-md border border-slate-300 bg-white p-2 text-sm" name="linkedinStatus" defaultValue={linkedInStatusOf(value)}>
      {LINKEDIN_STATUSES.map((status) => <option key={status} value={status}>{LINKEDIN_STATUS_LABELS[status]}</option>)}
    </select>
  </label>;
}

function CandidateCategoryField({ categories, value, name }: { categories: CategoryOption[]; value?: string | null; name?: string | null }) {
  return <label className="block space-y-2 text-xs font-semibold text-slate-700">Category
    {categories.length ? <select className="block w-full rounded-md border border-slate-300 bg-white p-2 text-sm" name="candidateCategoryId" defaultValue={value || ""}>
      <option value="">{value ? name : "Default category"}</option>
      {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select> : <span className="block text-sm font-normal">{name || "Global"}</span>}
  </label>;
}
