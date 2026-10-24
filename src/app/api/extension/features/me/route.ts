import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { managerCanManagePageExclusions } from "@/server/page-exclusions";
import { managerCanManageJobDetectionUrlRules } from "@/server/job-detection-url-rules";
import { managerCanManageTextHighlights } from "@/server/text-highlights";

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const [canManageTextHighlights, canManagePageExclusions, canManageJobDetectionUrlRules] = await Promise.all([
      managerCanManageTextHighlights(manager.id),
      managerCanManagePageExclusions(manager.id),
      managerCanManageJobDetectionUrlRules(manager.id),
    ]);
    return NextResponse.json(
      {
        success: true,
        features: {
          canManageTextHighlights,
          canManagePageExclusions,
          canManageJobDetectionUrlRules,
          canUseScanner: false,
          canUseApply: false,
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
