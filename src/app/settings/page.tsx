import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnChatGptUrlForm, OwnAutoApplyParallelLimitForm, OwnGenerationParallelLimitForm } from "@/app/settings/prompt-forms";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/ui/page-header";
import { cn } from "@/app/ui/cn";
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
      generationParallelLimit: users.generationParallelLimit,
      chatGptUrl: users.chatGptUrl,
    })
      .from(users).where(and(eq(users.id, currentUser.id), isNull(users.blockedAt))).limit(1);
    if (!manager) redirect("/");
    return (
      <main className="py-1">
        <PageHeader
          title="Your settings"
        />
        <SettingsCard title="ChatGPT Project URL" summary="Choose where your ChatGPT conversations open">
          <OwnChatGptUrlForm chatGptUrl={manager.chatGptUrl} />
        </SettingsCard>
        <SettingsCard summary={`${manager.autoApplyParallelLimit} jobs at once`} title="Concurrent jobs">
          <OwnAutoApplyParallelLimitForm parallelLimit={manager.autoApplyParallelLimit} />
        </SettingsCard>
        <SettingsCard
          summary={manager.generationParallelLimit === 1 ? "1 résumé at a time" : `${manager.generationParallelLimit} résumés at once`}
          title="Concurrent Generation"
        >
          <OwnGenerationParallelLimitForm parallelLimit={manager.generationParallelLimit} />
        </SettingsCard>
      </main>
    );
  }
  if (currentUser.role !== "super_admin") redirect("/");

  // Tabs are links (?tab=prompts), so each tab is server-rendered, loads only its own data, and can
  // be bookmarked. Managers opens first because it is the tab used most.
  const activeTab = parseSuperAdminSettingsTab((await searchParams).tab);

  return (
    <main className="py-1 text-fg">
      <PageHeader
        title="AI settings"
      />

      {/* Stays under the fixed workspace header (60px below 640px, 64px above) while the page scrolls. */}
      <nav
        aria-label="Settings sections"
        className="sticky top-[60px] z-30 mb-5 flex flex-wrap gap-1 rounded-card border border-line bg-card/90 p-1 shadow-sm backdrop-blur sm:top-16"
      >
        {SUPER_ADMIN_SETTINGS_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "min-w-[9rem] flex-1 rounded-control px-4 py-2.5 text-left transition-colors",
                active ? "bg-primary text-white shadow-sm" : "text-fg-muted hover:bg-line-soft hover:text-fg",
              )}
              href={`/settings?tab=${tab.id}`}
              key={tab.id}
            >
              <span className="block text-sm font-semibold">{tab.label}</span>
              <span className={cn("mt-0.5 block text-xs", active ? "text-white/75" : "text-fg-faint")}>{tab.description}</span>
            </Link>
          );
        })}
      </nav>

      {activeTab === "managers" && <ManagersTab />}
      {activeTab === "prompts" && <PromptsTab />}
      {activeTab === "general" && <GeneralTab />}
      {activeTab === "old" && <OldTab />}
    </main>
  );
}
