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
  Briefcase,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Eye,
  GraduationCap,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { DatePicker, MonthPicker } from "@/app/components/date-picker";
import { ConfirmButton } from "@/app/components/confirm-button";
import { FormCard, openCardOfInvalidField } from "@/app/components/form-card";
import { DIVERSITY_FIELDS } from "@/lib/diversity-options";
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
    async (previous: UserActionState, formData: FormData) => {
      const result = await createUserAction(previous, formData);
      // A saved account closes the window; its row appears in the list, and the next opening is empty.
      if (result.success) {
        setIsOpen(false);
        setEducationRows([0]);
        setExperienceRows([0]);
      }
      return result;
    },
    initialState,
  );
  // Messages belong to this opening, not to an earlier save or error.
  const [openedWith, setOpenedWith] = useState(state);
  const message = state === openedWith ? initialState : state;
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
        onClick={() => {
          setOpenedWith(state);
          setIsOpen(true);
        }}
        type="button"
      >
        <UserPlus aria-hidden="true" className="size-4" />
        Add {roleLabel}
      </button>
      <Modal
        confirmOnDismiss={isAccount}
        dismissQuestion="Discard this new account?"
        onClose={closeModal}
        open={isOpen}
        subtitle={
          isAccount
            ? "Add contact details and career information for this candidate."
            : "Set up a staff account in your reporting hierarchy."
        }
        title={`Create ${roleLabel}`}
      >
        <form action={formAction} className={isAccount ? "space-y-3" : "space-y-6"} onInvalidCapture={openCardOfInvalidField}>
        {isAccount ? (
          <>
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
            <SelectField
              id="categoryId"
              label="Category"
              name="categoryId"
              options={categories}
            />
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

        {message.error && <FormMessage variant="error">{message.error}</FormMessage>}
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

export function EditCandidateProfileForm({
  candidate,
  categories,
  readOnly = false,
}: {
  candidate: CandidateProfileValues;
  categories: CandidateCategoryOption[];
  // A blocked ("deleted") candidate: everything can be read, nothing changed.
  readOnly?: boolean;
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
    async (previous: UserActionState, formData: FormData) => {
      const result = await updateCandidateProfileAction(previous, formData);
      // A saved profile closes the window; the list shows the change.
      if (result.success) setIsOpen(false);
      return result;
    },
    initialState,
  );
  // Messages belong to this opening, not to an earlier save or error.
  const [openedWith, setOpenedWith] = useState(state);
  const message = state === openedWith ? initialState : state;
  const fieldId = (field: string) => `${field}-${candidate.userId}`;
  // Each opening starts from the saved history, newest first as the page loads it, so rows never
  // keep an earlier order or point at another entry after a save.
  const openEditor = () => {
    setEducationRows(candidate.education.length ? candidate.education.map((_, index) => index) : [0]);
    setExperienceRows(candidate.experience.length ? candidate.experience.map((_, index) => index) : [0]);
    nextEducationRowId.current = Math.max(1, candidate.education.length);
    nextExperienceRowId.current = Math.max(1, candidate.experience.length);
    setOpenedWith(state);
    setIsOpen(true);
  };

  return (
    <>
      <button
        aria-label={readOnly ? "View blocked candidate profile" : "Edit candidate profile"}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"
        onClick={openEditor}
        type="button"
      >
        {readOnly ? <Eye aria-hidden="true" className="size-3.5" /> : <Pencil aria-hidden="true" className="size-3.5" />}
        {readOnly ? "View" : "Edit"}
      </button>
      <Modal
        confirmOnDismiss={!readOnly}
        dismissQuestion="Discard unsaved changes?"
        onClose={closeModal}
        open={isOpen}
        subtitle={readOnly
          ? "This candidate is blocked: the profile can be read but not changed, and it is not used for jobs."
          : "Update the candidate's contact information and profile details."}
        title={readOnly ? "Blocked candidate (read-only)" : "Edit candidate profile"}
      >
        <form action={formAction} className="space-y-3" onInvalidCapture={openCardOfInvalidField}>
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
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
                disabled={isPending}
                type="submit"
              >
                {isPending && <LoadingIcon className="size-4" />}
                {isPending ? "Saving..." : "Save profile"}
              </button>
            )}
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
    <form action={formAction}>
      <input name="userId" type="hidden" value={userId} />
      <ConfirmButton
        ariaLabel={`Delete ${candidateName}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60"
        confirmLabel="Delete candidate"
        description={<>Delete {candidateName}? The account is blocked, not erased: their profile, Jobs, Bids, and history stay read-only on this page, and they are no longer used for Get JD, Generation, or Apply. This cannot be undone.</>}
        disabled={isPending}
        title="Delete this candidate?"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
        {isPending ? "Deleting..." : "Delete"}
      </ConfirmButton>
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
  // Whether anything in the form was changed since the window opened; only then does closing ask.
  const changedRef = useRef(false);
  const titleId = useId();
  const subtitleId = useId();

  const updateLeaveConfirmation = useCallback((show: boolean) => {
    showLeaveConfirmationRef.current = show;
    setShowLeaveConfirmation(show);
  }, []);
  const requestClose = useCallback(() => {
    if (confirmOnDismiss && changedRef.current) {
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

    changedRef.current = false;
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
      // "Keep editing" has the focus, so Enter never throws work away.
      leaveConfirmationRef.current
        ?.querySelector<HTMLButtonElement>("button[data-keep-editing]")
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
          onChangeCapture={() => {
            changedRef.current = true;
          }}
          onClickCapture={(event) => {
            // Calendars and "Add" buttons change the form without typing.
            if ((event.target as HTMLElement).closest("[data-changes-form]")) changedRef.current = true;
          }}
          onInputCapture={() => {
            changedRef.current = true;
          }}
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
                You changed this form but have not saved it. Discarding closes it and loses those changes.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  className="min-h-10 rounded-lg border border-rose-200 px-4 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                  onClick={cancelAndClose}
                  type="button"
                >
                  Discard changes
                </button>
                <button
                  className="min-h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  data-keep-editing
                  onClick={continueEditing}
                  type="button"
                >
                  Keep editing
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
    <form action={formAction} className="mt-2">
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
      <ConfirmButton
        className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        confirmLabel="Delete account"
        description={hasReports
          ? `Permanently delete this staff account and reassign ${reportsCount} direct report(s) to the selected peer? Their login history is deleted too. This cannot be undone.`
          : "Permanently delete this staff account? Their login history is deleted too. This cannot be undone."}
        disabled={isPending || noReplacementAvailable}
        title="Delete this account?"
      >
        {isPending && <LoadingIcon className="size-3.5" />}
        {isPending ? "Deleting..." : "Delete account"}
      </ConfirmButton>
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
    if (field.name === "pdfTemplate" || field.name === "categoryId") return;
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
        Static facts about this candidate, including their own answers to diversity questions. Salary, notice, sponsorship, right to work, relocation, and job preferences are the same for every candidate: Super Admin keeps them as reusable answers in Settings.
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
