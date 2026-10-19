import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      success: true,
      id: manager.id,
      username: manager.loginName,
      name: manager.displayName,
      role: manager.role,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
