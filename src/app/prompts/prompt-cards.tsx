"use client";

import { Plus, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

export type PromptCard = { id: string; label: string; meta?: string; preview?: string; content: ReactNode };

// One card per prompt, so a long prompt is read and edited on its own below the cards. The "+" card
// right after the prompts opens the new-prompt form; trailing cards (the default prompt) come after
// it. Every panel stays mounted, so unsaved text in one prompt is still there after opening another.
export function PromptCards({ tabs, trailing = [], create }: { tabs: PromptCard[]; trailing?: PromptCard[]; create: ReactNode }) {
  const allTabs = [...tabs, ...trailing];
  const [selectedId, setSelectedId] = useState(tabs[0]?.id ?? CREATE_ID);
  // A prompt just added shows up as a new card: open it, and start the create form over.
  const [knownIds, setKnownIds] = useState(() => tabs.map((tab) => tab.id));
  const [createKey, setCreateKey] = useState(0);
  const addedId = tabs.find((tab) => !knownIds.includes(tab.id))?.id;
  if (addedId || knownIds.length !== tabs.length) {
    setKnownIds(tabs.map((tab) => tab.id));
    if (addedId) {
      setSelectedId(addedId);
      setCreateKey((key) => key + 1);
    }
  }
  const creating = selectedId === CREATE_ID || allTabs.length === 0;
  const selected = creating ? null : allTabs.find((tab) => tab.id === selectedId) ?? allTabs[0];

  const card = (tab: PromptCard) => {
    const active = tab.id === selected?.id;
    return (
      <button
        aria-controls={`prompt-panel-${tab.id}`}
        aria-selected={active}
        className={`flex min-h-28 flex-col rounded-xl border p-4 text-left shadow-sm transition ${
          active
            ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100"
            : "border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md"
        }`}
        id={`prompt-tab-${tab.id}`}
        key={tab.id}
        onClick={() => setSelectedId(tab.id)}
        role="tab"
        type="button"
      >
        <span className="flex w-full items-start gap-2">
          <Sparkles aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${active ? "text-indigo-600" : "text-slate-400"}`} />
          <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${active ? "text-indigo-700" : "text-slate-800"}`}>{tab.label}</span>
        </span>
        {tab.meta && <span className="mt-1 text-[11px] text-slate-500">{tab.meta}</span>}
        {tab.preview && <span className="mt-2 line-clamp-2 font-mono text-[11px] leading-4 text-slate-500">{tab.preview}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div aria-label="Prompts" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="tablist">
        {tabs.map(card)}
        <button
          aria-controls={`prompt-panel-${CREATE_ID}`}
          aria-label="New prompt"
          aria-selected={creating}
          className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-xs font-semibold transition ${
            creating
              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
              : "border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-700"
          }`}
          id={`prompt-tab-${CREATE_ID}`}
          onClick={() => setSelectedId(CREATE_ID)}
          role="tab"
          title="New prompt"
          type="button"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm">
            <Plus aria-hidden="true" className="size-5" />
          </span>
          New prompt
        </button>
        {trailing.map(card)}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {allTabs.map((tab) => (
          <div
            aria-labelledby={`prompt-tab-${tab.id}`}
            className="p-5 sm:p-6"
            hidden={tab.id !== selected?.id}
            id={`prompt-panel-${tab.id}`}
            key={tab.id}
            role="tabpanel"
          >
            {tab.content}
          </div>
        ))}
        <div
          aria-labelledby={`prompt-tab-${CREATE_ID}`}
          className="p-5 sm:p-6"
          hidden={!creating}
          id={`prompt-panel-${CREATE_ID}`}
          role="tabpanel"
        >
          <h2 className="mb-4 text-sm font-semibold text-slate-800">New prompt</h2>
          <div key={createKey}>{create}</div>
        </div>
      </div>
    </div>
  );
}

const CREATE_ID = "new";
