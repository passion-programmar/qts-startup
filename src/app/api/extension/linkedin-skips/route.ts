import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { linkedInSkipsAllowed, readLinkedInSkipChanges, readSkipPairs, writeLinkedInSkips } from "@/server/linkedin-skips/linkedin-skips";

// LinkedIn skip-list for the extension: GET what changed since the Chrome's last look (?since=),
// POST { add: [{ title, company, location, source }], remove: [{ title, company }] } (up to 200 each).
// When the Super Admin turned the skip-list off for the Manager, GET says so and POST is refused.

const noStore = { "Cache-Control": "no-store" };
const turnedOff = { success: false, disabled: true, message: "Your Super Admin turned the LinkedIn skip-list off." };

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return NextResponse.json({ success: false, message: "Your QTS session has ended. Sign in again." }, { status: 401, headers: noStore });
  try {
    const since = new URL(request.url).searchParams.get("since");
    const changes = await readLinkedInSkipChanges(manager.id, since);
    if (changes.disabled) return NextResponse.json({ ...turnedOff, cursor: changes.cursor }, { status: 403, headers: noStore });
    return NextResponse.json({ success: true, ...changes }, { headers: noStore });
  } catch (error) {
    console.error("Could not read the LinkedIn skip-list.", error);
    return NextResponse.json({ success: false, message: "QTS could not read the LinkedIn skip-list." }, { status: 500, headers: noStore });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return NextResponse.json({ success: false, message: "Your QTS session has ended. Sign in again." }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => null) as { add?: unknown; remove?: unknown } | null;
  const add = readSkipPairs(body?.add);
  const remove = readSkipPairs(body?.remove);
  if (!body || !add || !remove || (!add.length && !remove.length)) {
    return NextResponse.json({ success: false, message: "Send up to 200 { title, company } pairs to add or remove." }, { status: 400, headers: noStore });
  }
  try {
    if (!(await linkedInSkipsAllowed(manager.id))) return NextResponse.json(turnedOff, { status: 403, headers: noStore });
    const written = await writeLinkedInSkips(manager.id, add, remove);
    return NextResponse.json({ success: true, ...written }, { headers: noStore });
  } catch (error) {
    console.error("Could not save the LinkedIn skip-list.", error);
    return NextResponse.json({ success: false, message: "QTS could not save the LinkedIn skip-list." }, { status: 500, headers: noStore });
  }
}
