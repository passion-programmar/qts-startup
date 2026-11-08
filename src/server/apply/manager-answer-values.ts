import { normalizeQuestionKey, parseReusableAnswer } from "./apply-values";
import { isPerCandidateQuestion, isNotGloballyReusableQuestion } from "./question-memory-values";
import semantics from "../../../extension/shared/semantic-fields.js";
import answerRepresentations, { type Representation } from "../../../extension/shared/answer-representations.js";
import answerIdentity, { type AnswerIdentity } from "../../../extension/shared/answer-identity.js";
export { answerIdentity };
export const recognizeSemanticField = semantics.recognize;

export type AnswerScope = "manager" | "candidate" | "application";
export type AnswerVariant = { kind: string; options: string[]; answer: string; questionText?: string; identity?: AnswerIdentity; policyContext?: string; representation?: Representation; normalVariation?: AnswerVariant };
// Only unambiguous profile mappings. Combined address/name questions remain scoped answers.
const PROFILE_FIELDS = [
  ["city", /^(?:location\s*\(?city\)?|city|town|current city|city of residence)$/i],
  ["firstName", /^(?:first name|given name|preferred first name)$/i],
  ["lastName", /^(?:last name|surname|family name)$/i],
  ["candidateEmail", /^(?:email|email address|e-mail)$/i],
  ["phone", /^(?:phone|phone number|mobile|mobile number)$/i],
  ["linkedinUrl", /^linkedin(?: profile)?(?: url| link)?$/i],
] as const;

export function profileField(question: string, normalApply = false) {
  if (normalApply) {
    const found = semantics.recognize(question);
    if (found?.blocked) return null;
    if (found?.definition) return found.definition.profileField ?? null;
  }
  return PROFILE_FIELDS.find(([, pattern]) => pattern.test(question.replace(/\s*\*\s*$/, "").trim()))?.[0] ?? null;
}

export function correctionScope(question: string, normalApply = false): AnswerScope {
  if (normalApply) {
    const found = semantics.recognize(question);
    if (found?.blocked) return "application";
    if (found?.definition) return found.definition.defaultScope;
  }
  if (profileField(question)) return "candidate";
  if (/\b(telephone|contact number|birth|passport|tax|national insurance|social security|legal name|maiden name)\b/i.test(question)) return "candidate";
  // This is a source question, not a question asking for the candidate's LinkedIn URL.
  if (/how did you (hear|find|learn)|where did you (hear|find)|referral source/i.test(question)) return "manager";
  // Country, employer, location and job-dependent answers must not leak into unrelated applications.
  if (/sponsor|authori[sz]|eligible|relocat|onsite|on-site|hybrid|salary|compensation|\bvisa\b|\brate\b|why|(?:this|that|our|the)\s+(?:company|employer|role|position|job|product|service)|heard of|\breferred\b|referral|recruiter|\bhere\b/i.test(question)) return "application";
  if (isPerCandidateQuestion(question) || /qualification|degree|citizen|notice|available|availability|start date/i.test(question)) return "candidate";
  if (isNotGloballyReusableQuestion(question)) return "application";
  // Unknown questions are retained, visibly uncertain, until the Manager broadens their scope.
  return /privacy|terms|consent|how did you hear|source|newsletter/i.test(question) ? "manager" : "application";
}

export function correctionKey(question: string): string {
  return /how did you (hear|find|learn)|where did you (hear|find)|referral source/i.test(question)
    ? "application source" : normalizeQuestionKey(question);
}

// Never one answer for all candidates: who the candidate is (identity, contacts, address, diversity),
// questions naming one company or role, and legal terms (QTS ticks acknowledgments by its own rule).
const IDENTITY_QUESTION = /\b(?:city|town|location|located|where (?:do|are) you (?:live|living|based|reside)|place of residence|name|surname|e-?mail|phone|mobile|telephone|address|street|postcode|postal|zip|linkedin|github|portfolio|website|gender|sex|race|ethnic\w*|veteran|disabilit\w*|orientation|pronouns?|age|dob|birth\w*|nationalit\w*|citizenship|passport|tax|national insurance|social security)\b/i;
const MANAGER_NEVER = /\b(?:privacy|terms|conditions|consent|attest\w*|certif\w*|data processing|background check)\b|\b(?:this|that|our|the)\s+(?:company|employer|role|position|job|product|service|team)\b/i;

export function canShareQuestion(question: string, normalApply = false): boolean {
  if (normalApply) {
    const found = semantics.recognize(question);
    if (found?.blocked) return false;
    if (found?.definition) return found.definition.allowedScopes.includes("manager");
    // Decision 2026-11-06: a Manager may set a default for all candidates on any other question
    // (relocation, remote, notice, salary, work rights, sponsorship, years, skills, tools); each
    // candidate's or application's own answer overrides it.
    if (correctionKey(question) === "application source") return true;
    return !profileField(question) && !IDENTITY_QUESTION.test(question) && !MANAGER_NEVER.test(question);
  }
  if (correctionKey(question) === "application source") return true;
  if (/\b(telephone|contact number|birth|passport|tax|national insurance|social security|legal name|maiden name)\b/i.test(question)) return false;
  return !profileField(question) && !isNotGloballyReusableQuestion(question);
}

export function parseCorrection(item: unknown, recognitionOptions: { normalApply?: boolean } = {}) {
  if (!item || typeof item !== "object") return "Invalid answer.";
  const raw = item as Record<string, unknown>;
  const parsed = parseReusableAnswer({ question: raw.question, answer: raw.answer, note: "" });
  if (typeof parsed === "string") return parsed;
  if (recognitionOptions.normalApply && typeof raw.semanticHint === "string"
    && semantics.recognize(parsed.questionText, { note: raw.semanticHint })?.reason === "contextual-subject") {
    return "This field describes another person or employer. Save a new question with an explicit subject instead of mapping it to the candidate.";
  }
  // Credentials, CAPTCHA and file data are never reusable answers.
  if (/password|passcode|captcha|verification code|one.time code|\bOTP\b/i.test(parsed.questionText)) return "Credentials and verification codes are not saved.";
  if (raw.kind === "file" || raw.kind === "password") return "Files and passwords are not saved.";
  const kind = typeof raw.kind === "string" ? raw.kind : "text";
  const options = Array.isArray(raw.options) ? raw.options.filter((entry): entry is string => typeof entry === "string" && entry.length <= 500).slice(0, 100) : [];
  // A choice must be one of the site's options; spacing and capitals may differ, and the site's own
  // wording is stored ("masters " → "Masters").
  if (options.length) {
    const plain = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    const offered = (value: string) => options.find((option) => option === value) ?? options.find((option) => plain(option) === plain(value));
    const chosen = kind === "checkbox-group" ? parsed.answer.split(" | ").map(offered) : [offered(parsed.answer)];
    if (chosen.some((option) => option === undefined)) {
      return `The answer is not one of the site's options (${options.filter((option) => !/^(select|choose)\b/i.test(option)).slice(0, 6).join(", ")}).`;
    }
    parsed.answer = chosen.join(" | ");
  }
  if (profileField(parsed.questionText, recognitionOptions.normalApply) === "candidateEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.answer)) return "Invalid email address.";
  const policyContext = typeof raw.policyContext === "string" && raw.policyContext.length <= 8000 ? raw.policyContext : undefined;
  const answer = profileField(parsed.questionText, recognitionOptions.normalApply) === "linkedinUrl"
    ? parsed.answer.replace(/^(?:(?:https?:)?\/\/)?(?:www\.)?linkedin\.com(?=[/?#]|$)/i, "https://www.linkedin.com") : parsed.answer;
  const representation = recognitionOptions.normalApply ? answerRepresentations.metadata(raw.representation) : undefined;
  if (recognitionOptions.normalApply && raw.representation && typeof raw.representation === "object") {
    const requested = raw.representation as Record<string, unknown>;
    for (const key of ["dateFormat", "numberFormat", "callingCode", "nationalSignificant", "unit", "nameOrder"] as const) {
      if (requested[key] !== undefined && representation?.[key] === undefined) return `The declared ${key} representation is unsupported or incomplete.`;
    }
  }
  if (representation?.dateFormat && !answerRepresentations.date(answer, representation.dateFormat)) return "The answer does not match the declared calendar date format.";
  if (representation?.nameOrder && (answer.split(',').length !== 2 || answer.split(',').some((part) => !part.trim()))) return "The declared name format requires exactly two nonempty comma-separated components.";
  if (representation?.nationalSignificant && !/^\d+$/.test(answer)) return "The national phone representation requires significant digits only.";
  return { ...parsed, answer, questionKey: correctionKey(parsed.questionText), kind, options, policyContext, representation, scope: correctionScope(parsed.questionText, recognitionOptions.normalApply) };
}

// Wording variants only survive when their meaning is known to agree. Distinct source channels
// never become synonyms. Other answers require exact equivalence; no broad semantic guessing.
export function answerMeaning(value: string): string {
  const text = value.toLowerCase().replace(/\s+/g, " ").trim();
  return /^(linkedin|linkedin job post|linkedin job posting|linkedin job board)$/.test(text) ? "linkedin job post" : text;
}

export function mergeVariants(existing: AnswerVariant[], next: AnswerVariant): AnswerVariant[] {
  const optionKey = answerIdentity.variantKey;
  return [...existing.filter((entry) => (!entry.identity || entry.identity.key === next.identity?.key) && answerMeaning(entry.answer) === answerMeaning(next.answer) && optionKey(entry) !== optionKey(next)), next].slice(-30);
}
