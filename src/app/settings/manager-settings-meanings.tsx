import { Ban, Bot, Brain, ClipboardCheck, Highlighter, Link2, MousePointerClick, Power, ScanSearch, Tags, type LucideIcon } from "lucide-react";

type ManagerSetting = {
  column: string;
  on: string;
  off: string;
  icon: LucideIcon;
  summary: string;
  onMeaning?: string;
  offMeaning?: string;
};

// What each Manager setting is called on the Settings page, the words for its two states, and what
// it does. The table columns, the switches and the meanings all read from here.
export const MANAGER_SETTINGS = {
  apply: {
    column: "Apply",
    on: "On",
    off: "Off",
    icon: Power,
    summary: "The main switch for applying.",
    onMeaning: "Normal Apply and Auto Apply work for this Manager's jobs that finished Generation.",
    offMeaning: "Both are refused, and the settings that depend on Apply are greyed out.",
  },
  autoApplyApi: {
    column: "Auto Apply with APIs",
    on: "On",
    off: "Off",
    icon: Bot,
    summary: "How Auto Apply answers form questions.",
    onMeaning: "Gemini and Groq answer through the QTS server, one request per page. The Manager still clicks Next and Submit.",
    offMeaning: "ChatGPT answers in a Chrome tab.",
  },
  geminiMatching: {
    column: "Get JD matching",
    on: "Gemini",
    off: "General",
    icon: ScanSearch,
    summary: "How Get JD matches jobs to candidates.",
    onMeaning: "Only candidates with a JD matching note are used, and a job needs its match result before Generation.",
    offMeaning: "No note or match result is needed.",
  },
  chatGptUrl: {
    column: "ChatGPT URL",
    on: "Link",
    off: "Blank",
    icon: Link2,
    summary: "Where ChatGPT opens for this Manager.",
    onMeaning: "Generation and Apply open this Project, with a fresh chat for each job and a new tab after 10 jobs.",
    offMeaning: "Resets to chatgpt.com.",
  },
  textHighlights: {
    column: "Text highlights",
    on: "Can edit",
    off: "View only",
    icon: Highlighter,
    summary: "Coloured words on job pages, shared by all Managers.",
    onMeaning: "This Manager adds and changes them in the extension.",
    offMeaning: "They see the colours but cannot change them.",
  },
  pageExclusions: {
    column: "Job-page keywords",
    on: "Can edit",
    off: "No access",
    icon: Tags,
    summary: "Words that tell QTS a page is a job page: at least two different saved keywords must appear in its visible text.",
    onMeaning: "The Manager keeps their own list under URL Settings in the extension.",
    offMeaning: "That list is hidden.",
  },
  jobDetectionUrls: {
    column: "Blocked URLs",
    on: "Can edit",
    off: "No access",
    icon: Ban,
    summary: "Web addresses where QTS stays out: it is blocked when the current address contains a saved fragment.",
    onMeaning: "The Manager keeps their own list under URL Settings in the extension.",
    offMeaning: "That list is hidden.",
  },
  aiMode: {
    column: "Answer AI",
    on: "Gemini",
    off: "ChatGPT",
    icon: Brain,
    summary: "Normal Apply uses no AI, and Auto Apply does not use this to choose its AI. With Auto Apply with APIs off, it only picks which application-answer prompt from the Global prompt library Auto Apply sends to ChatGPT. The developer test run calls the AI named here.",
  },
  reviewMode: {
    column: "Review",
    on: "Before Submit",
    off: "Every step",
    icon: ClipboardCheck,
    summary: "Used only by the developer test run: stop on every form step, or once before Submit. Normal Apply and Auto Apply do not follow it.",
  },
  autoSubmit: {
    column: "Submit",
    on: "Automatic",
    off: "Manager reviews",
    icon: MousePointerClick,
    summary: "Used only by the developer test run: whether it may click Submit by itself. QTS never clicks Submit in Normal Apply or Auto Apply.",
  },
} satisfies Record<string, ManagerSetting>;

export type ManagerSettingKey = keyof typeof MANAGER_SETTINGS;

function StatePill({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${on ? "bg-indigo-100 text-indigo-700" : "bg-slate-200/70 text-slate-600"}`}>
      {label}
    </span>
  );
}

export function ManagerSettingMeanings({ settings }: { settings: ManagerSettingKey[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-5 md:grid-cols-2">
      {settings.map((key) => {
        const setting: ManagerSetting = MANAGER_SETTINGS[key];
        const Icon = setting.icon;
        return (
          <li className="flex min-w-0 gap-3" key={key}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-100">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 text-xs leading-5 text-slate-600">
              <p className="text-[13px] font-semibold text-slate-900">{setting.column}</p>
              <p>{setting.summary}</p>
              {setting.onMeaning && setting.offMeaning ? (
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5">
                  <dt><StatePill label={setting.on} on /></dt>
                  <dd>{setting.onMeaning}</dd>
                  <dt><StatePill label={setting.off} on={false} /></dt>
                  <dd>{setting.offMeaning}</dd>
                </dl>
              ) : (
                <p className="mt-2 flex flex-wrap gap-1.5">
                  <StatePill label={setting.on} on />
                  <StatePill label={setting.off} on={false} />
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// The name and login at the start of each Manager row, with their initials as a small picture.
export function ManagerIdentity({ displayName, loginName }: { displayName: string | null; loginName: string | null }) {
  const name = displayName ?? "Manager";
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
  return (
    <div className="flex min-w-0 max-w-40 items-center gap-2.5 max-sm:max-w-none">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-[11px] font-semibold text-white shadow-sm shadow-indigo-500/25">
        {initials}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-slate-900" title={name}>{name}</div>
        <div className="truncate text-[11px] text-slate-500">@{loginName ?? "unknown"}</div>
      </div>
    </div>
  );
}
