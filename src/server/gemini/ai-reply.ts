// Reading what Gemini and Groq answered, into one shape the rest of QTS can act on. No database
// or network here, so every case can be tested with plain text.

type ReplyFacts = { httpStatus: number | null; durationMs: number; detail: string | null };

export type AiFailedReason = "overloaded" | "timeout" | "network";
export type AiBlockedReason =
  | "no_quota" | "model_missing" | "no_access" | "bad_key" | "bad_request" | "too_large" | "broken_reply";

export type AiOutcome =
  | { kind: "worked"; httpStatus: number; durationMs: number; modelVersion: string | null; text: string }
  | (ReplyFacts & { kind: "daily_limit"; limit: number | null })
  | (ReplyFacts & { kind: "minute_limit"; limit: number | null; retryAfterSeconds: number | null })
  | (ReplyFacts & { kind: "failed"; reason: AiFailedReason })
  | (ReplyFacts & { kind: "blocked"; reason: AiBlockedReason });

export type AiFailure = Exclude<AiOutcome, { kind: "worked" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const shortMessage = (error: Record<string, unknown>): string | null => {
  const message = typeof error.message === "string" ? error.message.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return message || null;
};

function readGeminiReplyText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.candidates) || !isRecord(data.candidates[0])) return "";
  const content = data.candidates[0].content;
  if (!isRecord(content) || !Array.isArray(content.parts)) return "";
  return content.parts.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("").trim();
}

function readQuotaValue(violation: Record<string, unknown> | undefined): number | null {
  if (!violation || violation.quotaValue === undefined) return null;
  const value = Number(violation.quotaValue);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function classifyGeminiLimit(error: Record<string, unknown>, facts: ReplyFacts): AiFailure {
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  const violations = details.flatMap((detail) => (Array.isArray(detail.violations) ? detail.violations.filter(isRecord) : []));
  const findQuota = (pattern: RegExp) => violations.find((violation) => typeof violation.quotaId === "string" && pattern.test(violation.quotaId));

  const daily = findQuota(/PerDay/i);
  if (daily || /per[ _]day|daily/i.test(facts.detail ?? "")) {
    const limit = readQuotaValue(daily);
    return limit === 0 ? { kind: "blocked", reason: "no_quota", ...facts } : { kind: "daily_limit", limit, ...facts };
  }
  // A per-minute token limit also lands here, but its number isn't a count of calls.
  const limit = readQuotaValue(findQuota(/Requests?PerMinute/i));
  if (limit === 0) return { kind: "blocked", reason: "no_quota", ...facts };
  const retryDelay = details.map((detail) => detail.retryDelay).find((value) => typeof value === "string");
  const seconds = typeof retryDelay === "string" ? Math.ceil(Number.parseFloat(retryDelay)) : Number.NaN;
  return { kind: "minute_limit", limit, retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null, ...facts };
}

const looksLikeBadGeminiKey = (error: Record<string, unknown>, detail: string | null): boolean => {
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  return details.some((entry) => entry.reason === "API_KEY_INVALID") || /api key (not valid|expired|invalid)/i.test(detail ?? "");
};

export function classifyGeminiReply(httpStatus: number, body: string, durationMs: number): AiOutcome {
  const data = parseJson(body);
  if (httpStatus >= 200 && httpStatus < 300) {
    const modelVersion = isRecord(data) && typeof data.modelVersion === "string" ? data.modelVersion : null;
    return { kind: "worked", httpStatus, durationMs, modelVersion, text: readGeminiReplyText(data) };
  }
  const error = isRecord(data) && isRecord(data.error) ? data.error : {};
  const facts: ReplyFacts = { httpStatus, durationMs, detail: shortMessage(error) };
  if (httpStatus === 429) return classifyGeminiLimit(error, facts);
  if (httpStatus >= 500) return { kind: "failed", reason: "overloaded", ...facts };
  if (httpStatus === 404) return { kind: "blocked", reason: "model_missing", ...facts };
  if (httpStatus === 401 || httpStatus === 403) return { kind: "blocked", reason: "no_access", ...facts };
  if (looksLikeBadGeminiKey(error, facts.detail)) return { kind: "blocked", reason: "bad_key", ...facts };
  return { kind: "blocked", reason: "bad_request", ...facts };
}

function classifyGroqLimit(error: Record<string, unknown>, facts: ReplyFacts, retryAfter: string | null): AiFailure {
  const detail = facts.detail ?? "";
  const limitMatch = /Limit\s+([\d,]+)/i.exec(detail);
  const limit = limitMatch ? Number(limitMatch[1].replaceAll(",", "")) : null;
  if (/per day|\((?:RPD|TPD)\)/i.test(detail)) return { kind: "daily_limit", limit, ...facts };
  const header = retryAfter === null ? Number.NaN : Number.parseFloat(retryAfter);
  const inMessage = /try again in\s+([\d.]+)\s*s/i.exec(detail);
  const seconds = Number.isFinite(header) ? header : inMessage ? Number.parseFloat(inMessage[1]) : Number.NaN;
  return {
    kind: "minute_limit",
    limit: /\(RPM\)/i.test(detail) ? limit : null,
    retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null,
    ...facts,
  };
}

export function classifyGroqReply(httpStatus: number, body: string, durationMs: number, retryAfter: string | null = null): AiOutcome {
  const data = parseJson(body);
  if (httpStatus >= 200 && httpStatus < 300) {
    const choice = isRecord(data) && Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : {};
    const message = isRecord(choice.message) ? choice.message : {};
    return {
      kind: "worked",
      httpStatus,
      durationMs,
      modelVersion: isRecord(data) && typeof data.model === "string" ? data.model : null,
      text: typeof message.content === "string" ? message.content.trim() : "",
    };
  }
  const error = isRecord(data) && isRecord(data.error) ? data.error : {};
  const facts: ReplyFacts = { httpStatus, durationMs, detail: shortMessage(error) };
  if (httpStatus === 429) return classifyGroqLimit(error, facts, retryAfter);
  if (httpStatus >= 500 || httpStatus === 498) return { kind: "failed", reason: "overloaded", ...facts };
  if (httpStatus === 401) return { kind: "blocked", reason: "bad_key", ...facts };
  if (httpStatus === 403) return { kind: "blocked", reason: "no_access", ...facts };
  if (httpStatus === 404) return { kind: "blocked", reason: "model_missing", ...facts };
  if (httpStatus === 413) return { kind: "blocked", reason: "too_large", ...facts };
  // Groq refuses a reply that wasn't valid JSON. That's a bad answer, not a bad request.
  if (error.code === "json_validate_failed") return { kind: "blocked", reason: "broken_reply", ...facts };
  return { kind: "blocked", reason: "bad_request", ...facts };
}

/** No HTTP reply at all. Only the error's name is kept, never its message. */
export function classifyAiNetworkError(errorName: string, durationMs: number): AiOutcome {
  const timedOut = errorName === "TimeoutError" || errorName === "AbortError";
  return { kind: "failed", reason: timedOut ? "timeout" : "network", httpStatus: null, durationMs, detail: null };
}

// ---- Asking Groq ----

type AiMessage = { role: "user" | "model"; parts: { text: string }[] };

const groqMaxReplyTokens = 4_096;

/** Groq uses the OpenAI request format. It needs asking for JSON in words as well as by setting. */
export function buildGroqChatBody(modelId: string, contents: AiMessage[], temperature: number, jsonHint?: string) {
  return {
    model: modelId,
    temperature,
    max_completion_tokens: groqMaxReplyTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `Reply with one JSON object only, and no other text.${jsonHint ? ` ${jsonHint}` : ""}` },
      ...contents.map((content) => ({
        role: content.role === "model" ? "assistant" : "user",
        content: content.parts.map((part) => part.text).join(""),
      })),
    ],
  };
}

/** Groq's models count more tokens per character than Gemini's, so this errs high. */
export function estimateGroqInputTokens(contents: AiMessage[], jsonHint?: string): number {
  const characters = contents.reduce((sum, content) => sum + content.parts.reduce((total, part) => total + part.text.length, 0), 0);
  return Math.ceil((characters + (jsonHint?.length ?? 0)) / 3.5) + 64;
}
