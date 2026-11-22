import { NextResponse } from "next/server";
import { authorizeApplyRequest } from "@/server/apply/apply-route-auth";

// Retired: questions Apply met are no longer collected ("Needs answer" list removed); reusable
// answers are added by hand on the Manager page. Older extensions still send here: accepted, not saved.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) { auth.headers.set("Cache-Control", "no-store"); return auth; }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
