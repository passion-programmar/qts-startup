"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultInterviewSettings, type InterviewSettings } from "@/server/interviews/interview-values";

export type CallerChoice = { id: string; name: string; label: string | null };

// What the page's parts share, sent once instead of with every row: the Manager's accounts and the
// category names (for the Add / Edit window), the calendar settings, and today in the chosen zone.
export type InterviewChoices = {
  accounts: { id: string; name: string; blocked: boolean }[];
  categories: string[];
  // The active callers of the Manager's Admin.
  callers: CallerChoice[];
  settings: InterviewSettings;
  today: string;
};

const InterviewChoicesContext = createContext<InterviewChoices>({ accounts: [], categories: [], callers: [], settings: defaultInterviewSettings, today: "" });

export function InterviewChoicesProvider({ value, children }: { value: InterviewChoices; children: ReactNode }) {
  return <InterviewChoicesContext value={value}>{children}</InterviewChoicesContext>;
}

export function useInterviewChoices(): InterviewChoices {
  return useContext(InterviewChoicesContext);
}
