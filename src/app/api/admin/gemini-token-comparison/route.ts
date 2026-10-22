import { NextResponse } from "next/server";
import { getGeminiApiKeys } from "@/lib/gemini-usage";
import { getCurrentUser } from "@/lib/session";
import {
  estimateGeminiInputTokens,
  geminiModel,
} from "@/server/gemini/gemini-request";
import { geminiJobEvaluationGenerationConfig } from "@/server/gemini/job-evaluation-config";

const maxPromptCharacters = 750_000;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isComparisonEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    typeof body.prompt !== "string" ||
    body.prompt.trim().length === 0 ||
    body.prompt.length > maxPromptCharacters
  ) {
    return NextResponse.json(
      { error: `Prompt must contain 1-${maxPromptCharacters.toLocaleString()} characters.` },
      { status: 400 },
    );
  }

  const apiKey = getGeminiApiKeys()[0];
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Gemini API key is configured on Vercel." },
      { status: 503 },
    );
  }

  const prompt = body.prompt;
  const localEstimate = estimateGeminiInputTokens(
    prompt,
    geminiJobEvaluationGenerationConfig,
  );
  let googleCount: number;
  try {
    googleCount = await requestGoogleTokenCount(apiKey, prompt);
  } catch (error) {
    console.error(
      "Temporary Gemini token comparison failed.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Google token counting failed. Check the Vercel function log." },
      { status: 502 },
    );
  }
  const difference = localEstimate - googleCount;
  const differencePercent =
    googleCount === 0 ? 0 : Number(((difference / googleCount) * 100).toFixed(2));

  return NextResponse.json({
    localEstimate,
    googleCount,
    difference,
    differencePercent,
    safe: localEstimate >= googleCount,
  });
}

function isComparisonEnabled(): boolean {
  return (
    process.env.VERCEL === "1" &&
    process.env.VERCEL_ENV === "production" &&
    process.env.ENABLE_GEMINI_TOKEN_COMPARISON === "true"
  );
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

async function requestGoogleTokenCount(
  apiKey: string,
  prompt: string,
): Promise<number> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:countTokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        generateContentRequest: {
          model: `models/${geminiModel}`,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: geminiJobEvaluationGenerationConfig,
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini CountTokens returned HTTP ${response.status}.`);
  }

  const data: unknown = await response.json();
  if (
    !isRecord(data) ||
    typeof data.totalTokens !== "number" ||
    !Number.isSafeInteger(data.totalTokens) ||
    data.totalTokens < 0
  ) {
    throw new Error("Gemini CountTokens returned an invalid token count.");
  }
  return data.totalTokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
