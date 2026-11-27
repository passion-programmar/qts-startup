import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    // One read of the Manager's row (2026-11-27: four, one per setting). Super Admin turns Apply on
    // per Manager and picks the AI that answers its open questions.
    const [applySettings] = await db.select({
      canManageTextHighlights: users.canManageTextHighlights,
      canManagePageExclusions: users.canManagePageExclusions,
      canManageJobDetectionUrlRules: users.canManageJobDetectionUrlRules,
      canUseApply: users.canUseApply,
      applyAiMode: users.applyAiMode,
      chatGptUrl: users.chatGptUrl,
      autoApplyParallelLimit: users.autoApplyParallelLimit,
      autoApplyApi: users.autoApplyApi,
    })
      .from(users).where(eq(users.id, manager.id)).limit(1);
    const canManageTextHighlights = applySettings?.canManageTextHighlights === true;
    const canManagePageExclusions = applySettings?.canManagePageExclusions === true;
    const canManageJobDetectionUrlRules = applySettings?.canManageJobDetectionUrlRules === true;
    return NextResponse.json(
      {
        success: true,
        features: {
          canManageTextHighlights,
          canManagePageExclusions,
          canManageJobDetectionUrlRules,
          canUseScanner: false,
          canUseApply: applySettings?.canUseApply === true,
          // Auto Apply answers only with Gemini and Groq: Apply on and Super Admin's "Auto Apply with APIs".
          canUseAutoApply: applySettings?.canUseApply === true && applySettings?.autoApplyApi === true,
          applyAiMode: applySettings?.applyAiMode === "gemini" ? "gemini" : "chatgpt",
          chatGptUrl: applySettings?.chatGptUrl || "https://chatgpt.com/",
          autoApplyParallelLimit: applySettings?.autoApplyParallelLimit ?? 2,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not load Manager extension features.", error);
    return NextResponse.json(
      { success: false, message: "Could not verify Manager extension permissions." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
