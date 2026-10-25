"use client";

import { ZoneClock } from "@/app/components/zone-clock";

// Japan and Romania time side by side, shown on every manager and admin page. The compact pair sits in
// the workspace header on wide screens; narrower screens show the full-size pair in the page instead.
export function WorkspaceClocks({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <div className={`${compact ? "flex gap-2" : "grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto"} ${className}`}>
      <ZoneClock className={compact ? "" : "sm:w-48"} compact={compact} label="Japan time" timeZone="Asia/Tokyo" />
      <ZoneClock className={compact ? "" : "sm:w-48"} compact={compact} label="Romania time" timeZone="Europe/Bucharest" />
    </div>
  );
}
