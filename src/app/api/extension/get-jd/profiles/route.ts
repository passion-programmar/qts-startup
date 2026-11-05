import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { categories, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";

const maxManagerAccounts = 100;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const [managerRow] = await db.select({ useGeminiMatching: users.useGeminiMatching }).from(users).where(eq(users.id, manager.id)).limit(1);
    const requireMatchingNote = managerRow?.useGeminiMatching === true;
    const rows = await db
      .select({
        id: profiles.userId,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        category: profiles.managerCategory,
        categoryId: profiles.categoryId,
        categoryName: categories.name,
        label: profiles.managerCategory,
        labelColor: profiles.managerCategoryColor,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .innerJoin(categories, eq(categories.id, profiles.categoryId))
      .where(and(
        eq(users.parentUserId, manager.id),
        eq(users.role, "account"),
        isNull(users.blockedAt),
        requireMatchingNote ? sql`length(regexp_replace(coalesce(${profiles.jdMatching}, ''), ${"\\s"}, '', 'g')) > 0` : sql`true`,
        sql`exists (select 1 from experiences e where e.profile_user_id = ${profiles.userId} group by e.profile_user_id having count(*) >= 3)`,
      ))
      .orderBy(asc(profiles.firstName), asc(profiles.lastName))
      .limit(maxManagerAccounts + 1);

    if (rows.length > maxManagerAccounts) {
      return NextResponse.json(
        { success: false, message: "You have too many active candidates to show at once." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({
      success: true,
      profiles: rows.map((profile) => ({
        id: profile.id,
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Candidate",
        category: profile.category || null,
        ...(!requireMatchingNote ? { categoryId: profile.categoryId, categoryName: profile.categoryName, label: profile.label, labelColor: profile.labelColor } : {}),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load manager candidate accounts for the extension.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not load candidate accounts." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
