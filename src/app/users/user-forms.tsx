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
import { LoadingIcon } from "@/app/components/loading-icon";
import { DatePicker } from "@/app/components/date-picker";
import { PasswordField } from "@/app/components/password-field";
import { minimumPasswordLength } from "@/lib/password-policy";
import { pdfTemplateLabels, pdfTemplateValues, type PdfTemplate } from "@/server/pdf/pdf-templates";
import { formatProfileMonth } from "@/server/users/profile-values";
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

export type CandidateCategoryOption = { id: string; name: string; isDefault: boolean };

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
        confirmOnDismiss={isAccount}
        dismissQuestion="Do you want to continue creating this Account?"
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
            <SelectField
              id="categoryId"
              label="Category"
              name="categoryId"
              options={categories}
            />
          </div>
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
                <TextField
                  autoComplete="off"
                  id={`educationStartDate-${rowId}`}
                  label="Start month (MM/YYYY)"
                  maxLength={7}
                  name="educationStartDate"
                  pattern="(0[1-9]|1[0-2])/[0-9]{4}"
                  placeholder="MM/YYYY"
                  inputMode="numeric"
                />
                <TextField
                  autoComplete="off"
                  id={`educationEndDate-${rowId}`}
                  label="End month (MM/YYYY)"
                  maxLength={7}
                  name="educationEndDate"
                  pattern="(0[1-9]|1[0-2])/[0-9]{4}"
                  placeholder="MM/YYYY"
                  inputMode="numeric"
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
                <TextField
                  autoComplete="off"
                  id={`experienceStartDate-${rowId}`}
                  label="Start month (MM/YYYY)"
                  maxLength={7}
                  name="experienceStartDate"
                  pattern="(0[1-9]|1[0-2])/[0-9]{4}"
                  placeholder="MM/YYYY"
                  inputMode="numeric"
                />
                <TextField
                  autoComplete="off"
                  id={`experienceEndDate-${rowId}`}
                  label="End month (MM/YYYY)"
                  maxLength={7}
                  name="experienceEndDate"
                  pattern="(0[1-9]|1[0-2])/[0-9]{4}"
                  placeholder="MM/YYYY"
                  inputMode="numeric"
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
              {isPending ? <LoadingIcon className="size-4" /> : <Plus className="size-4" />}
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
          className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-900 px-3 text-[10px] font-semibold text-white disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending && <LoadingIcon className="size-4" />}
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
  categoryId: string | null;
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
        confirmOnDismiss
        dismissQuestion="Do you want to continue editing this Profile?"
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
          <SelectField
            defaultValue={candidate.categoryId ?? ""}
            id={fieldId("categoryId")}
            label="Category"
            name="categoryId"
            options={categories}
          />
          </div>
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
                  <TextField autoComplete="off" defaultValue={formatProfileMonth(entry?.startDate ?? null)} id={fieldId(`educationStartDate-${rowId}`)} label="Start month (MM/YYYY)" maxLength={7} name="educationStartDate" pattern="(0[1-9]|1[0-2])/[0-9]{4}" placeholder="MM/YYYY" inputMode="numeric" />
                  <TextField autoComplete="off" defaultValue={formatProfileMonth(entry?.endDate ?? null)} id={fieldId(`educationEndDate-${rowId}`)} label="End month (MM/YYYY)" maxLength={7} name="educationEndDate" pattern="(0[1-9]|1[0-2])/[0-9]{4}" placeholder="MM/YYYY" inputMode="numeric" />
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
                  <TextField autoComplete="off" defaultValue={formatProfileMonth(entry?.startDate ?? null)} id={fieldId(`experienceStartDate-${rowId}`)} label="Start month (MM/YYYY)" maxLength={7} name="experienceStartDate" pattern="(0[1-9]|1[0-2])/[0-9]{4}" placeholder="MM/YYYY" inputMode="numeric" />
                  <TextField autoComplete="off" defaultValue={formatProfileMonth(entry?.endDate ?? null)} id={fieldId(`experienceEndDate-${rowId}`)} label="End month (MM/YYYY)" maxLength={7} name="experienceEndDate" pattern="(0[1-9]|1[0-2])/[0-9]{4}" placeholder="MM/YYYY" inputMode="numeric" />
                  <CurrentStatusCheckbox defaultChecked={entry?.isCurrent ?? false} id={fieldId(`experienceIsCurrent-${rowId}`)} label="Currently working here?" name="experienceIsCurrent" />
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
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
              disabled={isPending}
              type="submit"
            >
              {isPending && <LoadingIcon className="size-4" />}
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
        {isPending ? <LoadingIcon className="size-3.5" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
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
  confirmOnDismiss = false,
  dismissQuestion,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  confirmOnDismiss?: boolean;
  dismissQuestion: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const leaveConfirmationRef = useRef<HTMLDivElement>(null);
  const showLeaveConfirmationRef = useRef(false);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const titleId = useId();
  const subtitleId = useId();

  const updateLeaveConfirmation = useCallback((show: boolean) => {
    showLeaveConfirmationRef.current = show;
    setShowLeaveConfirmation(show);
  }, []);
  const requestClose = useCallback(() => {
    if (confirmOnDismiss) {
      updateLeaveConfirmation(true);
    } else {
      onClose();
    }
  }, [confirmOnDismiss, onClose, updateLeaveConfirmation]);
  const cancelAndClose = useCallback(() => {
    updateLeaveConfirmation(false);
    onClose();
  }, [onClose, updateLeaveConfirmation]);
  const continueEditing = useCallback(() => {
    updateLeaveConfirmation(false);
    dialogRef.current
      ?.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')
      ?.focus();
  }, [updateLeaveConfirmation]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocusScope = showLeaveConfirmationRef.current
      ? leaveConfirmationRef.current
      : dialogRef.current;
    const firstFocusable = initialFocusScope?.querySelector<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? dialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (showLeaveConfirmationRef.current) {
          continueEditing();
        } else {
          requestClose();
        }
        return;
      }

      const focusScope = showLeaveConfirmationRef.current
        ? leaveConfirmationRef.current
        : dialogRef.current;
      if (event.key !== "Tab" || !focusScope) return;
      const focusableElements = focusScope.querySelectorAll<HTMLElement>(
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
  }, [continueEditing, open, requestClose, updateLeaveConfirmation]);

  useEffect(() => {
    if (showLeaveConfirmation) {
      leaveConfirmationRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    }
  }, [showLeaveConfirmation]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        aria-describedby={subtitleId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5"
          inert={showLeaveConfirmation}
        >
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
            onClick={requestClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div
          className="overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
          inert={showLeaveConfirmation}
        >
          {children}
        </div>
        {showLeaveConfirmation && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/35 p-4">
            <div
              aria-describedby={`${titleId}-leave-description`}
              aria-labelledby={`${titleId}-leave-title`}
              aria-modal="true"
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
              ref={leaveConfirmationRef}
              role="alertdialog"
            >
              <h3
                className="text-base font-semibold text-slate-900"
                id={`${titleId}-leave-title`}
              >
                {dismissQuestion}
              </h3>
              <p
                className="mt-2 text-sm leading-6 text-slate-600"
                id={`${titleId}-leave-description`}
              >
                Choose Yes to keep this form open. Choose No to close it
                and discard unsaved changes.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  onClick={cancelAndClose}
                  type="button"
                >
                  No
                </button>
                <button
                  className="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  onClick={continueEditing}
                  type="button"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        )}
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
  pattern,
  inputMode,
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
  pattern?: string;
  inputMode?: "numeric";
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
        pattern={pattern}
        inputMode={inputMode}
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
        className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        disabled={isPending || noReplacementAvailable}
        type="submit"
      >
        {isPending && <LoadingIcon className="size-3.5" />}
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

function yesNoValue(value: boolean | null): string {
  return value === null ? "" : value ? "yes" : "no";
}

const YES_NO_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];

// Facts application forms ask for. Apply fills them only from here and stops when one is missing.
function ApplicationFactsSection({
  candidate,
  fieldId,
}: {
  candidate: CandidateProfileValues;
  fieldId: (field: string) => string;
}) {
  return (
    <section className="space-y-3">
      <input name="applicationFacts" type="hidden" value="1" />
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Application facts</h3>
        <p className="mt-1 text-xs text-slate-500">
          Apply fills form questions from these facts exactly; ChatGPT answers every other question from them, the résumé, and the job.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <TextField
            autoComplete="off"
            defaultValue={candidate.workAuthorization ?? ""}
            id={fieldId("workAuthorization")}
            label="Work authorization"
            maxLength={300}
            name="workAuthorization"
            placeholder="EU citizen; UK right to work"
          />
        </div>
        <ChoiceField
          defaultValue={yesNoValue(candidate.needsSponsorship)}
          id={fieldId("needsSponsorship")}
          label="Needs visa sponsorship"
          name="needsSponsorship"
          options={YES_NO_OPTIONS}
        />
        <ChoiceField
          defaultValue={candidate.noticePeriod === "1_week" ? "1_week" : "immediately"}
          id={fieldId("noticePeriod")}
          label="Notice period"
          name="noticePeriod"
          options={[
            { value: "immediately", label: "Immediately" },
            { value: "1_week", label: "1 week" },
          ]}
        />
        <TextField
          autoComplete="off"
          defaultValue={candidate.yearsOfExperience === null ? "" : String(candidate.yearsOfExperience)}
          id={fieldId("yearsOfExperience")}
          inputMode="numeric"
          label="Years of experience"
          maxLength={2}
          name="yearsOfExperience"
          pattern="[0-9]{1,2}"
        />
        <TextField
          autoComplete="off"
          defaultValue={candidate.salaryExpectationAmount === null ? "" : String(candidate.salaryExpectationAmount)}
          id={fieldId("salaryExpectationAmount")}
          inputMode="numeric"
          label="Salary expectation"
          maxLength={12}
          name="salaryExpectationAmount"
          pattern="[0-9]+"
          placeholder="70000"
        />
        <TextField
          autoComplete="off"
          defaultValue={candidate.salaryExpectationCurrency ?? ""}
          id={fieldId("salaryExpectationCurrency")}
          label="Salary currency"
          maxLength={3}
          name="salaryExpectationCurrency"
          placeholder="EUR"
        />
        <ChoiceField
          defaultValue={candidate.salaryExpectationPeriod ?? ""}
          id={fieldId("salaryExpectationPeriod")}
          label="Salary period"
          name="salaryExpectationPeriod"
          options={[
            { value: "", label: "Not set" },
            { value: "year", label: "Per year" },
            { value: "month", label: "Per month" },
            { value: "day", label: "Per day" },
            { value: "hour", label: "Per hour" },
          ]}
        />
        <ChoiceField
          defaultValue={yesNoValue(candidate.willingToRelocate)}
          id={fieldId("willingToRelocate")}
          label="Willing to relocate"
          name="willingToRelocate"
          options={YES_NO_OPTIONS}
        />
        <ChoiceField
          defaultValue={candidate.eeoPreference}
          id={fieldId("eeoPreference")}
          label="Diversity (EEO) questions"
          name="eeoPreference"
          options={[
            { value: "prefer_not_to_say", label: "Prefer not to say" },
            { value: "answer_from_profile", label: "Answer from the profile" },
          ]}
        />
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
          defaultValue={candidate.workCountries ?? ""}
          id={fieldId("workCountries")}
          label="May work without sponsorship in"
          maxLength={300}
          name="workCountries"
          placeholder="EU, UK"
        />
        <TextField
          autoComplete="off"
          defaultValue={candidate.workPermitExpiry ?? ""}
          id={fieldId("workPermitExpiry")}
          label="Work permit expires (optional)"
          maxLength={10}
          name="workPermitExpiry"
          type="date"
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
        <ChoiceField
          defaultValue={candidate.contractType ?? ""}
          id={fieldId("contractType")}
          label="Contract type"
          name="contractType"
          options={[
            { value: "", label: "Not set" },
            { value: "employment", label: "Employment contract" },
            { value: "b2b", label: "B2B / contractor" },
            { value: "either", label: "Either" },
          ]}
        />
        <ChoiceField
          defaultValue={candidate.workHours ?? ""}
          id={fieldId("workHours")}
          label="Working hours"
          name="workHours"
          options={[
            { value: "", label: "Not set" },
            { value: "full_time", label: "Full-time" },
            { value: "part_time", label: "Part-time" },
            { value: "either", label: "Either" },
          ]}
        />
        <ChoiceField
          defaultValue={candidate.workMode ?? ""}
          id={fieldId("workMode")}
          label="Work mode"
          name="workMode"
          options={[
            { value: "", label: "Not set" },
            { value: "remote", label: "Remote" },
            { value: "hybrid", label: "Hybrid" },
            { value: "onsite", label: "On-site" },
            { value: "any", label: "Any" },
          ]}
        />
        <TextAreaField
          className="sm:col-span-2 lg:col-span-3"
          defaultValue={candidate.applicationNotes ?? ""}
          id={fieldId("applicationNotes")}
          label="Notes for application answers (ChatGPT reads these)"
          maxLength={2000}
          name="applicationNotes"
        />
      </div>
    </section>
  );
}

function ChoiceField({
  id,
  label,
  name,
  options,
  defaultValue,
}: {
  id: string;
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={id}>
        {label}
      </label>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={defaultValue}
        id={id}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
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
        // Every candidate has a category; new ones start in the default.
        defaultValue={defaultValue || options.find((option) => option.isDefault)?.id || ""}
        required
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    </div>
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
