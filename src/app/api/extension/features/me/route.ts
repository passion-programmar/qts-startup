import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { managerCanManagePageExclusions } from "@/server/page-exclusions";
import { managerCanManageTextHighlights } from "@/server/text-highlights";

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const [canManageTextHighlights, canManagePageExclusions] = await Promise.all([
      managerCanManageTextHighlights(manager.id),
      managerCanManagePageExclusions(manager.id),
    ]);
    return NextResponse.json(
      {
        success: true,
        features: {
          canManageTextHighlights,
          canManagePageExclusions,
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
