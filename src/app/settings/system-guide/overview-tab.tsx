import { Bot, Boxes, Network, Route, Sparkles, Users } from "lucide-react";
import { Card, CardHeader } from "@/app/ui/card";
import { Area, Arrow, Code, Flow, Legend, Node, Note, type FlowStep } from "./guide-parts";

// "How it works": the parts of QTS and how they talk, who uses it, a job's path from a job page to
// an interview, Custom jobs, and the work that runs by itself.

const JOB_PATH: FlowStep[] = [
  { tone: "ext", title: "Find the job", text: "On a job page, Get JD reads the title, company and description. The Manager checks the draft (Gemini can check it too).", where: "Extension" },
  { tone: "web", title: "Save to Jobs", text: "Saved for one candidate account with status To do. It counts in the panel's Today: New and Job.", where: "Website + database" },
  { tone: "ai", title: "Write the résumé", text: "Generation sends the prompt to ChatGPT in its own tab and checks the answer. A failed one retries by itself.", where: "Extension + ChatGPT" },
  { tone: "pc", title: "Save the PDFs", text: "The résumé and cover letter are printed to PDF in Chrome and saved in Downloads\\QTS_Resume.", where: "This PC" },
  { tone: "ext", title: "Apply", text: "Apply or Auto Apply opens the job, fills the form from the profile and saved answers, and attaches the PDFs.", where: "Extension" },
  { tone: "web", title: "Submitted", text: "The Manager clicks Submitted: a bid is saved for good. The job row is cleared later by the daily clean-up.", where: "Website + database" },
  { tone: "web", title: "Interviews", text: "Rounds go Intro → Tech → Final → Offer on one job track, in CET, each with a caller.", where: "Website" },
  { tone: "web", title: "Overview", text: "Charts count bids per day against the target and show how the interview rounds went.", where: "Website" },
];

const ROLES: { title: string; tone: "git" | "web" | "ext" | "pc"; who: string; sees: string }[] = [
  { title: "Super Admin", tone: "git", who: "Runs the whole system (this account).", sees: "Overview, People, Categories, AI settings, Gemini usage, Database usage, System guide" },
  { title: "Admin", tone: "web", who: "Has Managers under them and keeps the Callers list.", sees: "Overview, People, Callers" },
  { title: "Manager", tone: "ext", who: "Owns candidate accounts and runs the Chrome extension.", sees: "Overview, Jobs, Bids, Interviews, Resume, People, prompts, Auto Apply settings" },
  { title: "Account", tone: "pc", who: "A candidate profile: experience, education, saved answers. It never signs in.", sees: "Every job, bid and interview belongs to one account and never moves to another." },
];

export function OverviewTab() {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader description="The extension works on job pages and in ChatGPT. The website keeps the lists and the rules. The database remembers everything." icon={<Network />} title="The parts and how they talk" />
        <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
          <Area title="Manager's PC · several Chromes, one PC">
            <Node lines={["Get JD reads job pages", "Generation writes résumés", "Apply / Auto Apply fill forms", "Custom: pasted jobs", "Today: New · Job · Applied"]} title="Chrome extension (QTS panel)" tone="ext" />
            <Arrow both label="prompt and answer" vertical />
            <Node lines={["Writes each résumé and cover letter in its own tab", "The Manager is signed in there"]} title="ChatGPT website" tone="ai" />
            <Arrow label="PDFs" vertical />
            <Node lines={["One folder per job: résumé + cover letter", "Apply attaches the files from here"]} title="Downloads\QTS_Resume" tone="pc" />
          </Area>
          <Arrow both label={<>HTTPS<br />signed-in API</>} />
          <Area title="Cloud">
            <Node lines={["The code. Branch main is the live site"]} title="GitHub · passion-programmar/qts-startup" tone="git" />
            <Arrow label="every push to main builds" vertical />
            <Node lines={["Pages for each role", "API the extension calls", "qts-job-system.vercel.app"]} title="QTS website · Vercel" tone="web" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <Arrow both label="reads and writes rows" vertical />
                <Node lines={["Users, jobs, bids, interviews, answers, settings"]} title="Neon Postgres" tone="db" />
              </div>
              <div className="min-w-0">
                <Arrow both label="API keys" vertical />
                <Node lines={["Get JD checks and Ask AI", "Gemini first, Groq last"]} title="Gemini · Groq" tone="ai" />
              </div>
            </div>
          </Area>
        </div>
        <div className="mt-4"><Legend /></div>
      </Card>

      <Card>
        <CardHeader description="Each role adds the next one. Callers belong to an Admin and are picked on interviews." icon={<Users />} title="Who uses QTS" />
        <div className="mt-4 grid gap-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
          {ROLES.map((role, index) => (
            <div className="contents" key={role.title}>
              {index > 0 ? <Arrow label="adds" /> : null}
              <Node title={role.title} tone={role.tone}>
                <p className="mt-1 text-[12.5px] leading-5 text-fg-soft">{role.who}</p>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{index === 3 ? "Rule" : "Sees"}</p>
                <p className="text-[12.5px] leading-5 text-fg-soft">{role.sees}</p>
              </Node>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader description="One job row is one job for one candidate: the same job for three candidates is three rows." icon={<Route />} title="A job's path, start to finish" />
        <div className="mt-4"><Flow steps={JOB_PATH} /></div>
      </Card>

      <Card>
        <CardHeader description="For an Easy Apply job or a recruiter's message, when there is no job page to read." icon={<Sparkles />} title="Custom jobs" />
        <div className="mt-4 grid gap-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
          <Node lines={["Account, job description, title, company, link or note"]} title="Paste in the panel" tone="ext" />
          <Arrow />
          <Node lines={["Goes to the front of the Generation queue", "Any Chrome running Generation writes it next"]} title="Résumé first" tone="ai" />
          <Arrow />
          <Node lines={["Its card shows in every Chrome, with the Chrome it was made in"]} title="Card everywhere" tone="ext" />
          <Arrow />
          <Node lines={["The Manager applies on the site, then clicks Submitted in any Chrome", "The bid is saved once"]} title="Submitted" tone="web" />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader description="No scheduled jobs (no cron): these run inside requests that happen anyway." icon={<Bot />} title="Work that runs by itself" />
          <ul className="mt-4 space-y-2.5 text-[13px] leading-6 text-fg-soft">
            <li><b className="text-fg">Applied job rows are cleared once a day</b>: on the first Get JD start after 4:00 PM Romania time. Bids are never cleared.</li>
            <li><b className="text-fg">Database clean-up</b>: old Generation runs, expired Get JD checks, Gemini logs older than 3 days, and questions unseen for 90 days. Settings: Database usage → Clean-up.</li>
            <li><b className="text-fg">Failed résumés retry by themselves</b>: after 10 minutes, 30 minutes, 1 hour and 2 hours.</li>
            <li><b className="text-fg">AI keys take turns</b>: in random order, no key twice until every key was used; when Gemini is busy, a lighter Gemini model, then Groq.</li>
            <li><b className="text-fg">Database limits</b>: a banner warns the Super Admin on every page when a Neon limit passes a level.</li>
          </ul>
        </Card>
        <Card>
          <CardHeader description="What the code is made of, for anyone who works on it." icon={<Boxes />} title="Built with" />
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] leading-6">
            <dt className="font-semibold text-fg">Website</dt><dd className="text-fg-soft">Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4</dd>
            <dt className="font-semibold text-fg">Database</dt><dd className="text-fg-soft">Neon Postgres through Drizzle ORM; migrations in <Code>drizzle/</Code></dd>
            <dt className="font-semibold text-fg">Extension</dt><dd className="text-fg-soft">Chrome, Manifest V3, plain JavaScript in <Code>extension/</Code></dd>
            <dt className="font-semibold text-fg">PDFs</dt><dd className="text-fg-soft">Printed in the extension&apos;s Chrome; the website can print them too with its own Chromium</dd>
            <dt className="font-semibold text-fg">Hosting</dt><dd className="text-fg-soft">Vercel (free Hobby plan) and Neon (free plan); usage on Database usage</dd>
            <dt className="font-semibold text-fg">Code</dt><dd className="text-fg-soft">GitHub, branch <Code>main</Code> = live; work branch <Code>qts-startup-deploy</Code></dd>
          </dl>
        </Card>
      </div>

      <Note>All times on the Interviews page are CET. Job dates use the job record time zone chosen in AI settings.</Note>
    </div>
  );
}
