"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  appLevels,
  checkQuota,
  cleanUpNow,
  deleteRows,
  dismissAlerts,
  MonitoringBusyError,
  previewDelete,
  readUsageState,
  runDiagnostics,
  saveKeepDays,
  savePlanLimits,
} from "@/server/database/database-usage";
import {
  formatBytes,
  GENERATION_KEEP_DAYS_MAX,
  parseDeleteRequest,
} from "@/server/database/database-usage-values";

export type DatabaseActionState = {
  error: string | null;
  success: string | null;
  // What a Check found, for the inputs it was asked with.
  preview?: { tableKey: string; mode: string; days: string; rows: number; bytes: number };
};

const emptyState: DatabaseActionState = { error: null, success: null };
const PAGE = "/settings/database-usage";

async function requireSuperAdmin(): Promise<string | null> {
  const actor = await requireUser();
  return actor.role === "super_admin" ? actor.id : null;
}

const readField = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, 40) : "";
};

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

export async function checkQuotaAction(): Promise<DatabaseActionState> {
  const actorId = await requireSuperAdmin();
  if (!actorId) return { ...emptyState, error: "Only Super Admin can check database usage." };
  try {
    const snapshot = await checkQuota(actorId);
    revalidatePath(PAGE);
    const neonErrors = snapshot.neon.state === "checked" ? snapshot.neon.projects.filter((project) => !project.ok).length : 0;
    return {
      error: null,
      success: !snapshot.database.ok
        ? "Checked, but the database did not answer: see Health."
        : neonErrors
          ? `Checked. Neon did not answer for ${plural(neonErrors, "project")}: see Health.`
          : "Checked. These numbers stay until the next Check quota.",
    };
  } catch (error) {
    if (error instanceof MonitoringBusyError) return { ...emptyState, error: error.message };
    console.error("Could not check database usage.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "QTS could not save the check. Please try again." };
  }
}

export async function runDiagnosticsAction(): Promise<DatabaseActionState> {
  const actorId = await requireSuperAdmin();
  if (!actorId) return { ...emptyState, error: "Only Super Admin can run diagnostics." };
  try {
    await runDiagnostics(actorId);
    revalidatePath(PAGE);
    return { error: null, success: "Diagnostics read. They stay until the next run." };
  } catch (error) {
    if (error instanceof MonitoringBusyError) return { ...emptyState, error: error.message };
    console.error("Could not run database diagnostics.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "QTS could not read the diagnostics. Please try again." };
  }
}

/** The banner's Dismiss: it shows again only when a quota gets worse. */
export async function dismissAlertsAction(): Promise<void> {
  const actorId = await requireSuperAdmin();
  if (!actorId) return;
  try {
    await dismissAlerts(appLevels(await readUsageState()), actorId);
  } catch (error) {
    console.error("Could not dismiss the database warning.", error instanceof Error ? error.message : error);
  }
  revalidatePath("/", "layout");
}

export async function previewDeleteAction(
  _previousState: DatabaseActionState,
  formData: FormData,
): Promise<DatabaseActionState> {
  if (!(await requireSuperAdmin())) return { ...emptyState, error: "Only Super Admin can delete database rows." };
  const tableKey = readField(formData, "table");
  const mode = readField(formData, "mode");
  const days = readField(formData, "days");
  const request = parseDeleteRequest(tableKey, mode, days);
  if (typeof request === "string") return { ...emptyState, error: request };
  try {
    const found = await previewDelete(request);
    return {
      error: null,
      success: found.rows
        ? `${plural(found.rows, "row")}, about ${formatBytes(found.bytes)}, will be deleted.`
        : "Nothing matches; no rows would be deleted.",
      preview: { tableKey, mode, days, ...found },
    };
  } catch (error) {
    console.error("Could not count rows to delete.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "QTS could not count the rows. Please try again." };
  }
}

export async function deleteRowsAction(
  _previousState: DatabaseActionState,
  formData: FormData,
): Promise<DatabaseActionState> {
  if (!(await requireSuperAdmin())) return { ...emptyState, error: "Only Super Admin can delete database rows." };
  const request = parseDeleteRequest(readField(formData, "table"), readField(formData, "mode"), readField(formData, "days"));
  if (typeof request === "string") return { ...emptyState, error: request };
  try {
    const result = await deleteRows(request);
    revalidatePath(PAGE);
    return {
      error: null,
      success: result.more
        ? `${plural(result.deleted, "row")} deleted. More are left: click Check and Delete again.`
        : `${plural(result.deleted, "row")} deleted from ${request.table.label}. Run diagnostics to update the table numbers.`,
    };
  } catch (error) {
    console.error("Could not delete database rows.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "The rows could not be deleted. Please try again." };
  }
}

export async function saveKeepDaysAction(
  _previousState: DatabaseActionState,
  formData: FormData,
): Promise<DatabaseActionState> {
  const actorId = await requireSuperAdmin();
  if (!actorId) return { ...emptyState, error: "Only Super Admin can change keep days." };
  const days = Number(readField(formData, "generationRuns").trim());
  if (!Number.isInteger(days) || days < 1 || days > GENERATION_KEEP_DAYS_MAX) {
    return { ...emptyState, error: `Enter whole days from 1 to ${GENERATION_KEEP_DAYS_MAX}.` };
  }
  try {
    await saveKeepDays(days, actorId);
  } catch (error) {
    console.error("Could not save keep days.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "The keep days could not be saved. Please try again." };
  }
  revalidatePath(PAGE);
  return { error: null, success: `Generation runs are kept ${plural(days, "day")}.` };
}

export async function savePlanLimitsAction(
  _previousState: DatabaseActionState,
  formData: FormData,
): Promise<DatabaseActionState> {
  const actorId = await requireSuperAdmin();
  if (!actorId) return { ...emptyState, error: "Only Super Admin can change plan limits." };
  const read = (name: string) => Number(readField(formData, name).trim());
  const limits = {
    storageMb: read("storageMb"),
    computeHours: read("computeHours"),
    transferGb: read("transferGb"),
    accountStorageGb: read("accountStorageGb"),
    thresholds: { warning: read("warning"), high: read("high"), critical: read("critical") },
  };
  const valid = (value: number) => Number.isFinite(value) && value > 0 && value <= 1_000_000;
  if (![limits.storageMb, limits.computeHours, limits.transferGb, limits.accountStorageGb].every(valid)) {
    return { ...emptyState, error: "Enter positive numbers for every limit." };
  }
  const { warning, high, critical } = limits.thresholds;
  if (![warning, high, critical].every((value) => Number.isFinite(value) && value > 0 && value < 100) || !(warning < high && high < critical)) {
    return { ...emptyState, error: "Levels must be percentages from 1 to 99, rising: warning < high < critical." };
  }
  try {
    await savePlanLimits(limits, actorId);
  } catch (error) {
    console.error("Could not save plan limits.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "The plan limits could not be saved. Please try again." };
  }
  revalidatePath(PAGE);
  return { error: null, success: "Plan limits saved." };
}

export async function cleanUpNowAction(): Promise<DatabaseActionState> {
  if (!(await requireSuperAdmin())) return { ...emptyState, error: "Only Super Admin can run the clean-up." };
  try {
    const result = await cleanUpNow(true);
    const total = Object.values(result.removed).reduce((sum, count) => sum + count, 0);
    revalidatePath(PAGE);
    return {
      error: null,
      success: `${plural(total, "row")} removed, about ${formatBytes(result.freedBytes)}.${result.more ? " More are left: run it again." : ""}`,
    };
  } catch (error) {
    console.error("The database clean-up failed.", error instanceof Error ? error.message : error);
    return { ...emptyState, error: "The clean-up could not run. Please try again." };
  }
}
