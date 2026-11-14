import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnChatGptUrlForm, OwnAutoApplyParallelLimitForm } from "@/app/settings/prompt-forms";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { SettingsCard } from "@/app/settings/settings-card";
import {
  GeneralTab,
  ManagersTab,
  OldTab,
  PromptsTab,
  parseSuperAdminSettingsTab,
  SUPER_ADMIN_SETTINGS_TABS,
} from "@/app/settings/super-admin-tabs";

export const instant = false;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role === "manager") {
    const [manager] = await db.select({
      autoApplyParallelLimit: users.autoApplyParallelLimit,
      chatGptUrl: users.chatGptUrl,
    })
      .from(users).where(and(eq(users.id, currentUser.id), isNull(users.blockedAt))).limit(1);
    if (!manager) redirect("/");
    return (
      <WorkspaceShell activeHref="/settings" user={currentUser}>
        <main className="py-1">
          <div className="mx-auto max-w-3xl">
            <PageHeader
              description="Set your ChatGPT Project URL and choose how many Auto Apply forms each Chrome can work on together."
              eyebrow="Manager settings"
              title="Your settings"
            />
            <SettingsCard title="ChatGPT Project URL" summary="Choose where your ChatGPT conversations open">
              <OwnChatGptUrlForm chatGptUrl={manager.chatGptUrl} />
            </SettingsCard>
            <SettingsCard summary={`${manager.autoApplyParallelLimit} jobs at once`} title="Concurrent jobs">
              <OwnAutoApplyParallelLimitForm parallelLimit={manager.autoApplyParallelLimit} />
            </SettingsCard>
          </div>
        </main>
      </WorkspaceShell>
    );
  }
  if (currentUser.role !== "super_admin") redirect("/");

  // Tabs are links (?tab=prompts), so each tab is server-rendered, loads only its own data, and can
  // be bookmarked. Managers opens first because it is the tab used most.
  const activeTab = parseSuperAdminSettingsTab((await searchParams).tab);

  return (
    <WorkspaceShell activeHref="/settings" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Choose what each Manager can use, keep the prompts AI follows, and set system-wide options."
          eyebrow="Administration"
          title="AI settings"
        />

        {/* Stays under the fixed workspace header (60px below 640px, 64px above) while the page scrolls. */}
        <nav
          aria-label="Settings sections"
          className="sticky top-[60px] z-30 mb-5 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/90 p-1 backdrop-blur sm:top-16"
        >
          {SUPER_ADMIN_SETTINGS_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`min-w-[9rem] flex-1 rounded-lg px-4 py-2.5 text-left transition ${
                  active
                    ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                }`}
                href={`/settings?tab=${tab.id}`}
                key={tab.id}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className={`mt-0.5 block text-xs ${active ? "text-slate-500" : "text-slate-400"}`}>
                  {tab.description}
                </span>
              </Link>
            );
          })}
        </nav>

        {activeTab === "managers" && <ManagersTab />}
        {activeTab === "prompts" && <PromptsTab />}
        {activeTab === "general" && <GeneralTab />}
        {activeTab === "old" && <OldTab />}
      </div>
    </main>
    </WorkspaceShell>
  );
}
