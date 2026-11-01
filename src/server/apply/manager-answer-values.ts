import { normalizeQuestionKey, parseReusableAnswer } from "./apply-values";
import { isPerCandidateQuestion } from "./question-memory-values";

export type AnswerScope = "manager" | "candidate" | "application";
export type AnswerVariant = { kind: string; options: string[]; answer: string };
// Only unambiguous profile mappings. Combined address/name questions remain scoped answers.
const PROFILE_FIELDS = [
  ["city", /^(?:location\s*\(?city\)?|city|town|current city|city of residence)$/i],
  ["firstName", /^(?:first name|given name|preferred first name)$/i],
  ["lastName", /^(?:last name|surname|family name)$/i],
  ["candidateEmail", /^(?:email|email address|e-mail)$/i],
  ["phone", /^(?:phone|phone number|mobile|mobile number)$/i],
  ["linkedinUrl", /^linkedin(?: profile)?(?: url| link)?$/i],
] as const;

export function profileField(question: string) {
  return PROFILE_FIELDS.find(([, pattern]) => pattern.test(question.replace(/\s*\*\s*$/, "").trim()))?.[0] ?? null;
}

export function correctionScope(question: string): AnswerScope {
  if (profileField(question)) return "candidate";
  // This is a source question, not a question asking for the candidate's LinkedIn URL.
  if (/how did you (hear|find|learn)|where did you (hear|find)|referral source/i.test(question)) return "manager";
  // Country, employer, location and job-dependent answers must not leak into unrelated applications.
  if (/sponsor|authori[sz]|eligible|relocat|onsite|on-site|hybrid|salary|compensation|\bvisa\b|\brate\b|why|our product|this company|this role|this position|this job|heard of|referred|referral|recruiter|\bhere\b/i.test(question)) return "application";
  if (isPerCandidateQuestion(question) || /qualification|degree|citizen|notice|available|availability|start date/i.test(question)) return "candidate";
  // Unknown questions are retained, visibly uncertain, until the Manager broadens their scope.
  return /privacy|terms|consent|how did you hear|source|newsletter/i.test(question) ? "manager" : "application";
}

export function correctionKey(question: string): string {
  return /how did you (hear|find|learn)|where did you (hear|find)|referral source/i.test(question)
    ? "application source" : normalizeQuestionKey(question);
}

export function canShareQuestion(question: string): boolean {
  if (correctionKey(question) === "application source") return true;
  return !profileField(question) && !isPerCandidateQuestion(question)
    && !/sponsor|authori[sz]|eligible|citizen|\bvisa\b|relocat|onsite|on-site|hybrid|qualification|degree/i.test(question);
}

export function parseCorrection(item: unknown) {
  if (!item || typeof item !== "object") return "Invalid answer.";
  const raw = item as Record<string, unknown>;
  const parsed = parseReusableAnswer({ question: raw.question, answer: raw.answer, note: "" });
  if (typeof parsed === "string") return parsed;
  // Credentials, CAPTCHA and file data are never reusable answers.
  if (/password|passcode|captcha|verification code|one.time code|\bOTP\b/i.test(parsed.questionText)) return "Credentials and verification codes are not saved.";
  if (raw.kind === "file" || raw.kind === "password") return "Files and passwords are not saved.";
  const kind = typeof raw.kind === "string" ? raw.kind : "text";
  const options = Array.isArray(raw.options) ? raw.options.filter((entry): entry is string => typeof entry === "string" && entry.length <= 500).slice(0, 100) : [];
  if (options.length && !options.includes(parsed.answer) && !(kind === "checkbox-group" && parsed.answer.split(" | ").every((answer) => options.includes(answer)))) return "The answer is not an offered choice.";
  if (profileField(parsed.questionText) === "candidateEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.answer)) return "Invalid email address.";
  const answer = profileField(parsed.questionText) === "linkedinUrl"
    ? parsed.answer.replace(/^(?:(?:https?:)?\/\/)?(?:www\.)?linkedin\.com(?=[/?#]|$)/i, "https://www.linkedin.com") : parsed.answer;
  return { ...parsed, answer, questionKey: correctionKey(parsed.questionText), kind, options, scope: correctionScope(parsed.questionText) };
}

// Wording variants only survive when their meaning is known to agree. Distinct source channels
// never become synonyms. Other answers require exact equivalence; no broad semantic guessing.
export function answerMeaning(value: string): string {
  const text = value.toLowerCase().replace(/\s+/g, " ").trim();
  return /^(linkedin|linkedin job post|linkedin job posting|linkedin job board)$/.test(text) ? "linkedin job post" : text;
}

export function mergeVariants(existing: AnswerVariant[], next: AnswerVariant): AnswerVariant[] {
  const optionKey = (entry: AnswerVariant) => `${entry.kind}:${[...entry.options].sort().join("|")}`;
  return [...existing.filter((entry) => answerMeaning(entry.answer) === answerMeaning(next.answer) && optionKey(entry) !== optionKey(next)), next].slice(-30);
}
