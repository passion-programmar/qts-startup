"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { PasswordField } from "@/app/components/password-field";
import { minimumPasswordLength } from "@/lib/password-policy";
import { pdfTemplateLabels, pdfTemplateValues, type PdfTemplate } from "@/server/pdf/pdf-templates";
import {
  createUserAction,
  deleteCandidateAccountAction,
  deleteStaffUserAction,
  type UserActionState,
  updateCandidateProfileAction,
  updateUserCredentialsAction,
} from "@/app/users/actions";

const initialState: UserActionState = { error: null, success: null };

type CreateUserFormProps = {
  role: "admin" | "manager" | "account";
  categories: CandidateCategoryOption[];
};

export type CandidateCategoryOption = { id: string; name: string; categoryName: string };

export function CreateUserForm({ role, categories }: CreateUserFormProps) {
  const [educationRows, setEducationRows] = useState([0]);
  const [experienceRows, setExperienceRows] = useState([0]);
  const [isOpen, setIsOpen] = useState(false);
  const closeModal = useCallback(() => setIsOpen(false), []);
  const [state, formAction, isPending] = useActionState(
    createUserAction,
    initialState,
  );
  const isAccount = role === "account";
  const roleLabel = isAccount
    ? "Candidate account"
    : role === "admin"
      ? "Admin"
      : "Manager";

  return (
    <>
      <button
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-indigo-600"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <UserPlus aria-hidden="true" className="size-4" />
        Add {roleLabel}
      </button>
      <Modal
        onClose={closeModal}
        open={isOpen}
        subtitle={
          isAccount
            ? "Add contact details and career information for this candidate."
            : "Set up a staff account in your reporting hierarchy."
        }
        title={`Create ${roleLabel}`}
      >
        <form action={formAction} className="space-y-6">
        {isAccount ? (
          <>
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
            <TextField
              autoComplete="bday"
              id="birthday"
              label="Birthday (optional)"
              maxLength={10}
              name="birthday"
              type="date"
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
            />
            <TextField
              autoComplete="organization-title"
              id="headline"
              label="Professional headline"
              maxLength={256}
              name="headline"
            />
            <TextField
              autoComplete="url"
              id="linkedinUrl"
              label="LinkedIn profile URL"
              maxLength={2048}
              name="linkedinUrl"
              type="url"
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
            <SelectField
              id="subCategoryId"
              label="Subcategory"
              name="subCategoryId"
              options={categories}
            />
          </div>
          <HistorySection
            addRow={() =>
              setEducationRows((rows) => [...rows, Math.max(-1, ...rows) + 1])
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
                <TextField
                  autoComplete="off"
                  id={`educationStartDate-${rowId}`}
                  label="Start month"
                  maxLength={7}
                  name="educationStartDate"
                  type="month"
                />
                <TextField
                  autoComplete="off"
                  id={`educationEndDate-${rowId}`}
                  label="End month"
                  maxLength={7}
                  name="educationEndDate"
                  type="month"
                />
                <CurrentStatusSelect
                  id={`educationIsCurrent-${rowId}`}
                  label="Currently studying here?"
                  name="educationIsCurrent"
                />
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
              setExperienceRows((rows) => [...rows, Math.max(-1, ...rows) + 1])
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
                <TextField
                  autoComplete="off"
                  id={`experienceStartDate-${rowId}`}
                  label="Start month"
                  maxLength={7}
                  name="experienceStartDate"
                  type="month"
                />
                <TextField
                  autoComplete="off"
                  id={`experienceEndDate-${rowId}`}
                  label="End month"
                  maxLength={7}
                  name="experienceEndDate"
                  type="month"
                />
                <CurrentStatusSelect
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
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              autoComplete="off"
              id="loginName"
              label="Username"
              maxLength={128}
              name="loginName"
              required
            />
            <div className="sm:col-span-2">
              <PasswordField
                autoComplete="new-password"
                id="newStaffPassword"
                label="Temporary password"
                minLength={minimumPasswordLength}
                name="password"
                placeholder="At least 4 characters"
                required
              />
            </div>
          </div>
        )}

        {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
        {state.success && (
          <FormMessage variant="success">{state.success}</FormMessage>
        )}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={isPending}
              type="submit"
            >
              <Plus className="size-4" />
              {isPending ? "Creating..." : `Create ${roleLabel}`}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

type CredentialResetFormProps = {
  userId: string;
  loginName: string;
};

export function CredentialResetForm({
  userId,
  loginName,
}: CredentialResetFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateUserCredentialsAction,
    initialState,
  );

  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-indigo-600 [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="size-3" />
        Change credentials
        <ChevronDown className="size-3 transition group-open:rotate-180" />
      </summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input name="userId" type="hidden" value={userId} />
        <TextField
          autoComplete="off"
          defaultValue={loginName}
          id={`resetLogin-${userId}`}
          label="Login name"
          maxLength={128}
          name="loginName"
        />
        <PasswordField
          autoComplete="new-password"
          id={`resetPassword-${userId}`}
          label="Set a new password (optional)"
          minLength={minimumPasswordLength}
          name="password"
          placeholder="At least 4 characters"
        />
        {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
        {state.success && (
          <FormMessage variant="success">{state.success}</FormMessage>
        )}
        <button
          className="h-8 rounded-md bg-slate-900 px-3 text-[10px] font-semibold text-white disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving..." : "Save credentials"}
        </button>
      </form>
    </details>
  );
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
  jdMatching: string | null;
  subCategoryId: string | null;
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
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string | null;
  }[];
};

export function EditCandidateProfileForm({
  candidate,
  categories,
}: {
  candidate: CandidateProfileValues;
  categories: CandidateCategoryOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [educationRows, setEducationRows] = useState(() =>
    candidate.education.length ? candidate.education.map((_, index) => index) : [0],
  );
  const [experienceRows, setExperienceRows] = useState(() =>
    candidate.experience.length ? candidate.experience.map((_, index) => index) : [0],
  );
  const nextEducationRowId = useRef(Math.max(1, candidate.education.length));
  const nextExperienceRowId = useRef(Math.max(1, candidate.experience.length));
  const closeModal = useCallback(() => setIsOpen(false), []);
  const [state, formAction, isPending] = useActionState(
    updateCandidateProfileAction,
    initialState,
  );
  const fieldId = (field: string) => `${field}-${candidate.userId}`;

  return (
    <>
      <button
        aria-label="Edit candidate profile"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <Pencil aria-hidden="true" className="size-3.5" />
        Edit
      </button>
      <Modal
        onClose={closeModal}
        open={isOpen}
        subtitle="Update the candidate's contact information and profile details."
        title="Edit candidate profile"
      >
        <form action={formAction} className="space-y-6">
          <input name="userId" type="hidden" value={candidate.userId} />
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
          <TextField
            autoComplete="bday"
            defaultValue={candidate.birthday ?? ""}
            id={fieldId("birthday")}
            label="Birthday (optional)"
            maxLength={10}
            name="birthday"
            type="date"
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
          />
          <TextField
            autoComplete="organization-title"
            defaultValue={candidate.headline ?? ""}
            id={fieldId("headline")}
            label="Professional headline"
            maxLength={256}
            name="headline"
          />
          <TextAreaField
            className="sm:col-span-2 lg:col-span-3"
            defaultValue={candidate.jdMatching ?? ""}
            id={fieldId("jdMatching")}
            label="JD matching notes (optional)"
            maxLength={5000}
            name="jdMatching"
          />
          <TextField
            autoComplete="url"
            defaultValue={candidate.linkedinUrl ?? ""}
            id={fieldId("linkedinUrl")}
            label="LinkedIn profile URL"
            maxLength={2048}
            name="linkedinUrl"
            type="url"
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
          <SelectField
            defaultValue={candidate.subCategoryId ?? ""}
            id={fieldId("subCategoryId")}
            label="Subcategory"
            name="subCategoryId"
            options={categories}
          />
          </div>
          <HistorySection
            addRow={() =>
              setEducationRows((rows) => [...rows, nextEducationRowId.current++])
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
                  <TextField autoComplete="off" defaultValue={entry?.startDate ?? ""} id={fieldId(`educationStartDate-${rowId}`)} label="Start month" maxLength={7} name="educationStartDate" type="month" />
                  <TextField autoComplete="off" defaultValue={entry?.endDate ?? ""} id={fieldId(`educationEndDate-${rowId}`)} label="End month" maxLength={7} name="educationEndDate" type="month" />
                  <CurrentStatusSelect defaultValue={entry?.isCurrent ? "true" : "false"} id={fieldId(`educationIsCurrent-${rowId}`)} label="Currently studying here?" name="educationIsCurrent" />
                  <TextAreaField className="sm:col-span-2 xl:col-span-3" defaultValue={entry?.description ?? ""} id={fieldId(`educationDescription-${rowId}`)} label="Description (optional)" maxLength={5000} name="educationDescription" />
                </>
              );
            }}
          </HistorySection>
          <HistorySection
            addRow={() =>
              setExperienceRows((rows) => [...rows, nextExperienceRowId.current++])
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
                  <TextField autoComplete="off" defaultValue={entry?.startDate ?? ""} id={fieldId(`experienceStartDate-${rowId}`)} label="Start month" maxLength={7} name="experienceStartDate" type="month" />
                  <TextField autoComplete="off" defaultValue={entry?.endDate ?? ""} id={fieldId(`experienceEndDate-${rowId}`)} label="End month" maxLength={7} name="experienceEndDate" type="month" />
                  <CurrentStatusSelect defaultValue={entry?.isCurrent ? "true" : "false"} id={fieldId(`experienceIsCurrent-${rowId}`)} label="Currently working here?" name="experienceIsCurrent" />
                  <TextAreaField className="sm:col-span-2 xl:col-span-3" defaultValue={entry?.description ?? ""} id={fieldId(`experienceDescription-${rowId}`)} label="Responsibilities / achievements (optional)" maxLength={5000} name="experienceDescription" />
                </>
              );
            }}
          </HistorySection>
          {state.error && <FormMessage variant="error">{state.error}</FormMessage>}
          {state.success && (
            <FormMessage variant="success">{state.success}</FormMessage>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteCandidateAccountForm({
  userId,
  candidateName,
}: {
  userId: string;
  candidateName: string;
}) {
  const [state, formAction, isPending] = useActionState(
    deleteCandidateAccountAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Permanently delete ${candidateName}? Their profile, Jobs, Bids, education, and experience records will also be deleted.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="userId" type="hidden" value={userId} />
      <button
        aria-label={`Delete ${candidateName}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {state.error && (
        <span className="mt-1 block max-w-36 text-[10px] leading-tight text-rose-700" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function CopyLinkedInUrl({ url }: { url: string }) {
  return (
    <CopyableAccountField
      ariaLabel="Copy LinkedIn URL"
      className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"
      value={url}
    >
      LinkedIn
    </CopyableAccountField>
  );
}

export function CopyableAccountField({
  value,
  ariaLabel,
  className = "",
  children,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`block w-full cursor-copy text-left transition hover:text-indigo-700 ${className}`}
      onClick={() => void navigator.clipboard.writeText(value)}
      title="Click to copy"
      type="button"
    >
      {children}
    </button>
  );
}

function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? dialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-describedby={subtitleId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <h2
              className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl"
              id={titleId}
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500" id={subtitleId}>
              {subtitle}
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {children}
        </div>
      </div>
    </div>
  );
}

function TextField({
  id,
  label,
  name,
  maxLength,
  required = false,
  autoComplete,
  defaultValue,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  name: string;
  maxLength: number;
  required?: boolean;
  autoComplete: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        autoComplete={autoComplete}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={defaultValue}
        id={id}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </div>
  );
}

export function DeleteStaffUserForm({
  userId,
  reportsCount,
  replacementUsers,
}: {
  userId: string;
  reportsCount: number;
  replacementUsers: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(
    deleteStaffUserAction,
    initialState,
  );
  const hasReports = reportsCount > 0;
  const noReplacementAvailable = hasReports && replacementUsers.length === 0;

  return (
    <form
      action={formAction}
      className="mt-2"
      onSubmit={(event) => {
        if (
          !window.confirm(
            hasReports
              ? `Permanently delete this staff account and reassign ${reportsCount} direct report(s) to the selected peer? This also deletes their login history.`
              : "Permanently delete this staff account? This also deletes their login history.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input name="userId" type="hidden" value={userId} />
      {hasReports && replacementUsers.length > 0 && (
        <div className="mb-3">
          <label
            className="mb-2 block text-[10px] font-semibold text-slate-600"
            htmlFor={`replacementUser-${userId}`}
          >
            Reassign {reportsCount} direct report(s) to
          </label>
          <select
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            defaultValue=""
            id={`replacementUser-${userId}`}
            name="replacementUserId"
            required
          >
            <option disabled value="">
              Choose an active peer
            </option>
            {replacementUsers.map((replacement) => (
              <option key={replacement.id} value={replacement.id}>
                {replacement.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {noReplacementAvailable && (
        <FormMessage variant="error">
          Add another active peer at this level before deleting this account.
        </FormMessage>
      )}
      {state.error && (
        <FormMessage variant="error">{state.error}</FormMessage>
      )}
      {state.success && (
        <FormMessage variant="success">{state.success}</FormMessage>
      )}
      <button
        className="h-8 rounded-md border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        disabled={isPending || noReplacementAvailable}
        type="submit"
      >
        {isPending ? "Deleting..." : "Delete account"}
      </button>
    </form>
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
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 p-4 sm:col-span-2 sm:p-5 xl:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        <button
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-200 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={rowIds.length >= 20}
        onClick={addRow}
        type="button"
        >
          <Plus className="size-3.5" />
          Add {title.toLowerCase()}
        </button>
      </div>
      {rowIds.map((rowId, index) => (
        <fieldset
          className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-3"
          key={rowId}
        >
          <legend className="px-1 text-[11px] font-semibold text-slate-600">
            {title} entry {index + 1}
          </legend>
          {children(rowId)}
          <button
            aria-label={`Remove ${title.toLowerCase()} entry ${index + 1}`}
            className="inline-flex h-9 items-center justify-center gap-2 justify-self-start rounded-lg px-3 text-[11px] font-medium text-rose-700 transition hover:bg-rose-50"
            onClick={() => onRemove(rowId)}
            type="button"
          >
            <Trash2 className="size-3.5" />
            Remove entry
          </button>
        </fieldset>
      ))}
    </section>
  );
}

function SelectField({
  id,
  label,
  name,
  options,
  defaultValue = "",
}: {
  id: string;
  label: string;
  name: string;
  options: CandidateCategoryOption[];
  defaultValue?: string;
}) {
  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        id={id}
        name={name}
        defaultValue={defaultValue}
      >
        <option value="">No category</option>
        {Array.from(
          options.reduce((groups, option) => {
            const group = groups.get(option.categoryName) ?? [];
            group.push(option);
            groups.set(option.categoryName, group);
            return groups;
          }, new Map<string, CandidateCategoryOption[]>()),
          ([categoryName, categoryOptions]) => (
            <optgroup key={categoryName} label={categoryName}>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </optgroup>
          ),
        )}
      </select>
    </div>
  );
}

function CurrentStatusSelect({
  id,
  label,
  name,
  defaultValue = "false",
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: "true" | "false";
}) {
  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold text-slate-700"
        htmlFor={id}
      >
        {label}
      </label>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={defaultValue}
        id={id}
        name={name}
      >
        <option value="false">No</option>
        <option value="true">Yes</option>
      </select>
    </div>
  );
}

function PdfTemplateField({
  id,
  defaultValue = "heritage",
}: {
  id: string;
  defaultValue?: PdfTemplate;
}) {
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

function FormMessage({
  children,
  variant,
}: {
  children: string;
  variant: "error" | "success";
}) {
  return (
    <p
      aria-live="polite"
      className={`rounded-lg border px-3.5 py-3 text-xs ${
        variant === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
      role={variant === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
