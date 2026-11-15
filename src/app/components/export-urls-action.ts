"use server";

import { getCurrentUser } from "@/lib/session";
import { readUrlsAddedOnDay } from "@/server/jobs/urls-added-on-day";

/** Export today's URLs (Jobs and Bids pages): the Manager's job and bid URLs added on one day, in one list. */
export async function urlsAddedOnDayAction(day: string): Promise<{ url: string; date: string }[]> {
  const manager = await getCurrentUser();
  if (!manager || manager.role !== "manager" || typeof day !== "string") return [];
  return readUrlsAddedOnDay(manager.id, day);
}
