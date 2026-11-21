import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { Badge } from "@/app/ui/badge";
import { PageHeader } from "@/app/ui/page-header";
import { LinkTabs } from "@/app/ui/tabs";
import { readEnvStatus } from "@/server/system/env-guide-values";
import { DeployTab } from "./deploy-tab";
import { EnvTab } from "./env-tab";
import { OverviewTab } from "./overview-tab";

export const instant = false;

// The Super Admin's System guide: how QTS is built (with drawings), how to deploy it, and every
// environment variable with whether it is set on this deployment. Nothing secret is ever shown:
// only names, and for some a safe fact (how many keys, which database user, how long a secret is).

type GuideTab = "overview" | "deploy" | "env";

const TABS: { id: GuideTab; label: string }[] = [
  { id: "overview", label: "How it works" },
  { id: "deploy", label: "Deploy" },
  { id: "env", label: "Environment variables" },
];

export default async function SystemGuidePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const currentUser = await requireUser();
  if (currentUser.role !== "super_admin") redirect("/");
  const requested = (await searchParams).tab;
  const activeTab: GuideTab = requested === "deploy" || requested === "env" ? requested : "overview";

  // Read here, on the server, as booleans and safe facts only: no value leaves this function.
  const onVercel = process.env.VERCEL === "1";
  const status = readEnvStatus(process.env, onVercel);
  const problems = status.filter((entry) => entry.problem);
  // What this deployment was built from (Vercel sets these by itself; none is secret).
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7);
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim().slice(0, 40);
  const vercelEnv = process.env.VERCEL_ENV?.trim().slice(0, 20);

  return (
    <main className="py-1 text-fg">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="How QTS is built, how a release goes live, and every setting it needs. Open it again whenever you deploy or change a setting."
          title="System guide"
        />

        {/* This deployment at a glance: where it runs, what it was built from, and whether a setting needs fixing. */}
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
          <Badge dot tone={onVercel ? "primary" : "neutral"}>{onVercel ? `Vercel · ${vercelEnv ?? "unknown"}` : "This PC (npm run dev)"}</Badge>
          {branch ? <Badge>branch {branch}</Badge> : null}
          {commit ? <Badge>commit {commit}</Badge> : null}
          <a href="?tab=env">
            <Badge dot tone={problems.length ? "danger" : "success"}>
              {problems.length ? `${problems.length} setting${problems.length === 1 ? "" : "s"} to fix` : "All settings OK"}
            </Badge>
          </a>
        </div>

        <LinkTabs
          className="mb-5"
          items={TABS.map((tab) => ({
            href: tab.id === "overview" ? "/settings/system-guide" : `/settings/system-guide?tab=${tab.id}`,
            label: tab.label,
            active: tab.id === activeTab,
            ...(tab.id === "env" && problems.length ? { count: problems.length } : {}),
          }))}
          label="System guide sections"
        />

        {activeTab === "overview" ? <OverviewTab /> : null}
        {activeTab === "deploy" ? <DeployTab /> : null}
        {activeTab === "env" ? <EnvTab onVercel={onVercel} status={status} /> : null}
      </div>
    </main>
  );
}
