import { KeyRound, Lock, PencilLine, Server } from "lucide-react";
import { Badge } from "@/app/ui/badge";
import { Card, CardHeader } from "@/app/ui/card";
import { ENV_VAR_GUIDE, type EnvPlace, type EnvStatus, type EnvVarGuide } from "@/server/system/env-guide-values";
import { CopyCommand } from "./copy-command";
import { Arrow, Code, Node, Note, Step } from "./guide-parts";

// "Environment variables": every variable QTS reads, grouped by where it is set, with whether it is
// set on this deployment (never its value), and how to add or change one.

const GROUPS: { places: EnvPlace[]; need?: EnvVarGuide["need"][]; title: string; description: string }[] = [
  { places: ["both", "vercel"], need: ["required", "optional"], title: "Set on Vercel (the live site)", description: "Vercel → project qts-job-system → Settings → Environment Variables → Production." },
  { places: ["local"], need: ["local"], title: "Only on this PC (.env.local)", description: "The file .env.local in the project folder. It is never committed and never sent to Vercel." },
  { places: ["automatic"], title: "Set by themselves", description: "Vercel and Node set these; never type them in." },
  { places: ["local"], need: ["unused"], title: "Not used", description: "Read by no code. Safe to remove." },
];

const PLACE_LABEL: Record<EnvPlace, string> = { both: "Vercel + .env.local", vercel: "Vercel", local: ".env.local", automatic: "Automatic" };
const NEED_TONE: Record<EnvVarGuide["need"], "danger" | "primary" | "neutral"> = { required: "danger", optional: "primary", local: "neutral", automatic: "neutral", unused: "neutral" };
const NEED_LABEL: Record<EnvVarGuide["need"], string> = { required: "Required", optional: "Optional", local: "This PC only", automatic: "Automatic", unused: "Not used" };

function StatusCell({ entry, guide, onVercel }: { entry: EnvStatus | undefined; guide: EnvVarGuide; onVercel: boolean }) {
  if (!entry) return null;
  if (entry.problem) {
    return (
      <span className="flex flex-col gap-1">
        <Badge dot tone="danger">{entry.set ? "Fix" : "Missing"}</Badge>
        <span className="text-[11.5px] leading-4 text-danger-text">{entry.problem}</span>
      </span>
    );
  }
  // Local-only ones are not expected on the live site, and the live-site ones not on this PC.
  const notHere = (onVercel && guide.place === "local") || (!onVercel && guide.place === "vercel");
  return (
    <span className="flex flex-col gap-1">
      {entry.set ? <Badge dot tone="success">Set</Badge> : <Badge dot>{notHere ? "Not needed here" : "Not set"}</Badge>}
      {entry.detail ? <span className="text-[11.5px] leading-4 text-fg-muted">{entry.detail}</span> : null}
    </span>
  );
}

export function EnvTab({ status, onVercel }: { status: EnvStatus[]; onVercel: boolean }) {
  const byName = new Map(status.map((entry) => [entry.name, entry]));
  const localTemplate = ENV_VAR_GUIDE
    .filter((entry) => entry.place === "both" || (entry.place === "local" && entry.need === "local" && !entry.name.startsWith("QTS_")))
    .map((entry) => `${entry.name}=${entry.name === "DATABASE_URL" ? "postgresql://neondb_owner:…@ep-…-pooler.….neon.tech/neondb?sslmode=require" : entry.example ? entry.example : ""}`)
    .join("\n");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          description={`What this ${onVercel ? "live site" : "PC"} has right now. Values are never shown: only whether each one is set, and a safe fact such as how many keys a list holds.`}
          icon={<KeyRound />}
          title="Every environment variable"
        />
        <div className="mt-4 space-y-6">
          {GROUPS.map((group) => {
            const rows = ENV_VAR_GUIDE.filter((entry) => group.places.includes(entry.place) && (!group.need || group.need.includes(entry.need)));
            if (!rows.length) return null;
            return (
              <section key={group.title}>
                <h3 className="text-sm font-semibold text-fg">{group.title}</h3>
                <p className="mb-2 text-xs text-fg-muted">{group.description}</p>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                    <thead className="bg-line-soft text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                      <tr>
                        <th className="px-3 py-2.5" scope="col">Name</th>
                        <th className="px-3 py-2.5" scope="col">Where</th>
                        <th className="px-3 py-2.5" scope="col">{onVercel ? "On the live site" : "On this PC"}</th>
                        <th className="px-3 py-2.5" scope="col">What it does</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((guide) => (
                        <tr className="align-top" key={guide.name}>
                          <td className="px-3 py-3">
                            <span className="flex items-center gap-1.5 font-mono text-[12.5px] font-semibold text-fg">
                              {guide.secret ? <Lock aria-label="Secret" className="size-3.5 shrink-0 text-amber-700" /> : null}
                              {guide.name}
                            </span>
                            <Badge className="mt-1.5" tone={NEED_TONE[guide.need]}>{NEED_LABEL[guide.need]}</Badge>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-fg-soft">{PLACE_LABEL[guide.place]}</td>
                          <td className="w-48 px-3 py-3"><StatusCell entry={byName.get(guide.name)} guide={guide} onVercel={onVercel} /></td>
                          <td className="px-3 py-3 text-fg-soft">
                            <p className="leading-5">{guide.purpose}</p>
                            {guide.note ? <p className="mt-1 text-[12px] leading-5 text-fg-muted">{guide.note}</p> : null}
                            {guide.example && guide.place !== "automatic" ? <p className="mt-1 text-[12px] text-fg-muted">Looks like: <Code>{guide.example}</Code></p> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-fg-muted"><Lock aria-hidden="true" className="size-3.5 text-amber-700" /> A secret: mark it Sensitive on Vercel, and never paste it in chat, commits or screenshots.</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader description="A change reaches the site only with a new deployment." icon={<PencilLine />} title="Add or change a variable on Vercel" />
          <div className="mt-4 grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <Node lines={["Settings → Environment Variables"]} title="Edit" tone="git" />
            <Arrow />
            <Node lines={["Deployments → newest Production → Redeploy"]} title="Redeploy" tone="git" />
            <Arrow />
            <Node lines={["This tab shows Set"]} title="Check" tone="web" />
          </div>
          <ol className="mt-5 space-y-5">
            <Step number={1} title="Edit">
              <p>Vercel → project <b>qts-job-system</b> → Settings → Environment Variables. Choose <b>Production</b>. For a secret, tick <b>Sensitive</b>.</p>
            </Step>
            <Step number={2} title="Redeploy">
              <p>Deployments → the newest Production build → ⋯ → <b>Redeploy</b>. Until then the site still uses the old value.</p>
            </Step>
            <Step number={3} title="Check here">
              <p>Open this tab again: the variable shows <b>Set</b> and no problem.</p>
            </Step>
          </ol>
          <div className="mt-4 space-y-2">
            <Note tone="warn">Vercel never shows a Sensitive value again, and <Code>vercel env pull</Code> gives an empty placeholder for it. Keep your own copy in a password manager.</Note>
            <Note tone="danger">Changing <b>AUTH_SECRET</b> signs everyone out and makes the saved job-site and mailbox passwords unreadable. Changing the database password needs the same change in DATABASE_URL, then a Redeploy.</Note>
          </div>
        </Card>

        <Card>
          <CardHeader description="For npm run dev, migrations and seeds. It stays on this PC." icon={<Server />} title=".env.local on this PC" />
          <p className="mt-4 text-[13px] leading-6 text-fg-soft">Create <Code>.env.local</Code> in the project folder with these names. Fill in your own values; the lines below are only the shape.</p>
          <div className="mt-3"><CopyCommand text={localTemplate} /></div>
          <div className="mt-4 space-y-2">
            <Note>Here DATABASE_URL is the <b>neondb_owner</b> address (migrations need it). The live site uses <b>qts_runtime</b>.</Note>
            <Note tone="warn">Running <Code>npm run dev</Code> with this file works on the live database. Use the same AUTH_SECRET as Vercel, or passwords saved locally cannot be read on the live site.</Note>
            <Note>Gemini and Groq keys are not needed here: AI is called only from the live site.</Note>
          </div>
        </Card>
      </div>
    </div>
  );
}
