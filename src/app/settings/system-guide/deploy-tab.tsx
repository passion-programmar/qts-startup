import { Database, History, ListChecks, Puzzle, Rocket, Wrench } from "lucide-react";
import { Card, CardHeader } from "@/app/ui/card";
import { CopyCommand } from "./copy-command";
import { Arrow, Code, Node, Note, Step } from "./guide-parts";

// "Deploy": how a release reaches the live site, the checklist, rolling back, database changes,
// extension releases, and setting everything up from zero.

const RUNTIME_ROLE_SQL = `-- Run once in the Neon SQL editor, signed in as neondb_owner.
-- Choose a new strong password; it goes only into Vercel's DATABASE_URL.
CREATE ROLE qts_runtime LOGIN PASSWORD 'choose-a-strong-password';
GRANT USAGE ON SCHEMA public TO qts_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qts_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qts_runtime;
-- Tables and sequences that later migrations create get the same rights by themselves:
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qts_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO qts_runtime;`;

export function DeployTab() {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader description="A push to main is a release: there is no other button. The database is changed first, from this PC." icon={<Rocket />} title="How a release goes live" />
        <div className="mt-4 grid gap-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
          <Node lines={["Branch qts-startup-deploy", "Tests pass", "Migrations applied first"]} title="This PC" tone="pc" />
          <Arrow label={<>git push startup<br />qts-startup-deploy:main</>} />
          <Node lines={["passion-programmar/qts-startup", "Branch main"]} title="GitHub" tone="git" />
          <Arrow label="builds by itself" />
          <Node lines={["Project qts-job-system", "Production build, usually 1–2 minutes"]} title="Vercel" tone="git" />
          <Arrow label="goes live" />
          <Node lines={["https://qts-job-system.vercel.app", "Every Manager's extension talks to it"]} title="Live site" tone="web" />
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <Note>Only <b>main</b> deploys: <Code>vercel.json</Code> turns builds off for every other branch, so there are no Preview deployments.</Note>
          <Note tone="warn">Use the remote named <b>startup</b>. A plain <Code>git push</Code> goes to the work branch on GitHub and does not deploy.</Note>
        </div>
      </Card>

      <Card>
        <CardHeader description="In this order, every time. Run the commands in the project folder on this PC." icon={<ListChecks />} title="Release checklist" />
        <ol className="mt-5 space-y-6">
          <Step number={1} title="See what will go live">
            <p>Other work may be on the same branch: check the list before you push.</p>
            <CopyCommand label="Commits that will go live" text={"git fetch startup\ngit log --oneline startup/main..HEAD"} />
            <CopyCommand label="Must print nothing (else someone pushed first: git pull startup main)" text="git log --oneline HEAD..startup/main" />
          </Step>
          <Step number={2} title="Run the checks">
            <CopyCommand text={"npm run typecheck\nnpm run lint\nnpm test"} />
          </Step>
          <Step number={3} title="Change the database first (only when drizzle/ has new migrations)">
            <p>Uses the owner address in <Code>.env.local</Code>. The live site keeps working, because migrations only add.</p>
            <CopyCommand text="npm run db:migrate" />
          </Step>
          <Step number={4} title="Push to main">
            <CopyCommand text="git push startup qts-startup-deploy:main" />
          </Step>
          <Step number={5} title="Watch the build">
            <p>Vercel → project <b>qts-job-system</b> → Deployments → the newest <b>Production</b> build must say <b>Ready</b>. It sometimes starts a few minutes late: wait before pushing again.</p>
          </Step>
          <Step number={6} title="Check the live site">
            <ul className="list-disc space-y-1 pl-5">
              <li><a className="text-primary-text underline" href="https://qts-job-system.vercel.app/login" rel="noreferrer" target="_blank">/login</a> opens, and <a className="text-primary-text underline" href="https://qts-job-system.vercel.app/api/extension/auth/health" rel="noreferrer" target="_blank">/api/extension/auth/health</a> answers.</li>
              <li>Sign in and open the pages that changed.</li>
              <li>This guide → Environment variables shows <b>All settings OK</b>.</li>
            </ul>
          </Step>
          <Step number={7} title="Extension changed too? Release it">
            <p>See <b>Extension release</b> below. Deploy the website first: a new extension can call new website addresses.</p>
          </Step>
        </ol>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader description="Go back to the last good release in a minute." icon={<History />} title="If a release breaks something" />
          <ol className="mt-4 space-y-5">
            <Step number={1} title="Open the last good release">
              <p>Vercel → Deployments → the newest <b>Production</b> build from before the problem.</p>
            </Step>
            <Step number={2} title="Pick how to go back">
              <p><b>Redeploy</b> builds that release again with today&apos;s environment variables: the safe choice.</p>
              <p><b>Instant Rollback</b> puts the old build back as it was, with the variables it had then. Use it only if no variable has changed since; an old database password, for example, no longer works.</p>
            </Step>
            <Step number={3} title="Or undo it in the code">
              <CopyCommand text={"git revert <commit>\ngit push startup qts-startup-deploy:main"} />
            </Step>
          </ol>
          <div className="mt-4"><Note tone="warn">The database does not go back by itself. That is why migrations only add: the older code keeps working with the newer tables.</Note></div>
        </Card>

        <Card>
          <CardHeader description="Two database users: one for the live site, one for changing tables." icon={<Database />} title="Database changes (migrations)" />
          <div className="mt-4 grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <Node lines={["Vercel's DATABASE_URL", "Reads and writes rows only", "Cannot change tables"]} title="qts_runtime · live site" tone="db" />
            <Arrow label="same database" both />
            <Node lines={[".env.local on this PC only", "Owns the tables, runs migrations", "Never on Vercel"]} title="neondb_owner · migrations" tone="db" />
          </div>
          <ol className="mt-5 space-y-5">
            <Step number={1} title="Change the tables in code, then make the migration">
              <p>Edit <Code>src/db/schema.ts</Code>, then:</p>
              <CopyCommand text="npm run db:generate -- --name short_name" />
              <p>Read the new SQL file in <Code>drizzle/</Code> and commit it with the code.</p>
            </Step>
            <Step number={2} title="Apply it before the push">
              <CopyCommand text="npm run db:migrate" />
              <p>Running it twice is safe: applied migrations are recorded in <Code>drizzle.__drizzle_migrations</Code>.</p>
            </Step>
          </ol>
          <div className="mt-4 space-y-2">
            <Note>Only add in one release: new tables, new columns (empty or with a default), new values. Remove old ones in a later release, when no live code uses them.</Note>
            <Note>Before a risky change, take a copy: Neon console → Branches → Create branch from main.</Note>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader description="This PC runs the extension folder directly; other PCs get a zip." icon={<Puzzle />} title="Extension release" />
        <ol className="mt-5 grid gap-6 lg:grid-cols-2">
          <Step number={1} title="Raise the version">
            <p>In <Code>extension/manifest.json</Code>, e.g. 1.60.2 → 1.60.3.</p>
          </Step>
          <Step number={2} title="Build the zip">
            <CopyCommand text="npm run build:extension" />
            <p>Makes <Code>dist/qts-extension-&lt;version&gt;.zip</Code>.</p>
          </Step>
          <Step number={3} title="This PC">
            <p><Code>chrome://extensions</Code> → QTS → reload (↻) in every Chrome.</p>
          </Step>
          <Step number={4} title="Other PCs">
            <p>Unzip to a folder → <Code>chrome://extensions</Code> → Developer mode on → Load unpacked → choose the folder. For an update, replace the folder&apos;s files and reload.</p>
          </Step>
          <Step number={5} title="Sign in on the panel">
            <p><b>Hosting</b> = the live site. <b>Local</b> = <Code>http://127.0.0.1:1027</Code> while <Code>npm run dev</Code> runs.</p>
          </Step>
          <Step number={6} title="For developers">
            <p>A new <Code>/api/extension/…</Code> address must also be added to the list in <Code>extension/shared/api-worker.js</Code>, or the panel says the workflow is not enabled.</p>
          </Step>
        </ol>
      </Card>

      <Card>
        <CardHeader description="Only for a new database or a new Vercel project. The live site is already set up." icon={<Wrench />} title="Set up from zero" />
        <ol className="mt-5 space-y-6">
          <Step number={1} title="Database">
            <p>Neon → new project. Put its <b>owner</b> connection address in <Code>.env.local</Code> as DATABASE_URL, then:</p>
            <CopyCommand text={"npm install\nnpm run db:migrate"} />
          </Step>
          <Step number={2} title="The live site's database user">
            <CopyCommand label="Neon SQL editor" text={RUNTIME_ROLE_SQL} />
          </Step>
          <Step number={3} title="First Super Admin and the default prompts">
            <p>Put SUPER_ADMIN_DISPLAY_NAME, SUPER_ADMIN_LOGIN_NAME and SUPER_ADMIN_PASSWORD in <Code>.env.local</Code>, then:</p>
            <CopyCommand text={"npm run db:seed:super-admin\nnpm run db:seed:prompts"} />
          </Step>
          <Step number={4} title="A secret for AUTH_SECRET">
            <CopyCommand text={`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`} />
          </Step>
          <Step number={5} title="Vercel">
            <p>New Project → import <b>passion-programmar/qts-startup</b> → Settings → Git → Production Branch <b>main</b> → Environment Variables (Production): DATABASE_URL with <b>qts_runtime</b>, AUTH_SECRET, GEMINI_API_KEYS, and the optional ones from the Environment variables tab → Deploy.</p>
          </Step>
          <Step number={6} title="Check">
            <p>Sign in as Super Admin → System guide → Environment variables must show <b>All settings OK</b>. Then load the extension and sign in with Hosting.</p>
          </Step>
        </ol>
      </Card>
    </div>
  );
}
