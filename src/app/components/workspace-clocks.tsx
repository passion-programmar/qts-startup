"use client";

import { ZoneClock } from "@/app/components/zone-clock";

// Japan and Romania time side by side, shown on every manager and admin page.
export function WorkspaceClocks() {
  return (
    <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
      <ZoneClock className="sm:w-48" label="Japan time" timeZone="Asia/Tokyo" />
      <ZoneClock className="sm:w-48" label="Romania time" timeZone="Europe/Bucharest" />
    </div>
  );
}
