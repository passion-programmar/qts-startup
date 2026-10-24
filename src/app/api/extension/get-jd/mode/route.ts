import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { success: true, mode: await getGetJdMatchingMode() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
