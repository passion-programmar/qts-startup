"use client";

import { createContext, useContext } from "react";
import { ZoneClock } from "@/app/components/zone-clock";

// Set by the workspace shell: managers and admins see the clocks, Super Admins do not.
export const WorkspaceClocksContext = createContext(false);

// Japan and Romania time side by side, shown in the header of every manager and admin page.
export function WorkspaceClocks() {
  if (!useContext(WorkspaceClocksContext)) return null;
  return (
    <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
      <ZoneClock className="sm:w-48" label="Japan time" timeZone="Asia/Tokyo" />
      <ZoneClock className="sm:w-48" label="Romania time" timeZone="Europe/Bucharest" />
    </div>
  );
}
