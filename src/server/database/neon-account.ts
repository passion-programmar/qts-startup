import "server-only";

import {
  endpointIdOfHost,
  type NeonProjectUsage,
  parseNeonBranches,
  parseNeonEndpoints,
  parseNeonProject,
  parseProjectIds,
} from "./database-usage-values";

// Neon's management API, for what the database cannot report about itself: the billing period's
// compute and transfer counters, the size of every branch, and whether each compute is running.
// These calls never wake a compute. NEON_API_KEY is only ever sent to Neon; NEON_PROJECT_ID may
// list several projects, each with its own allowance.

const NEON_API = "https://console.neon.tech/api/v2";

export type NeonProjectResult =
  | ({ ok: true; isAppProject: boolean } & NeonProjectUsage & { endpointError: string | null; branchError: string | null })
  | { ok: false; id: string; isAppProject: boolean; error: string };

export type NeonAccountUsage =
  | { state: "not_configured" }
  | { state: "checked"; projects: NeonProjectResult[] };

class NeonApiError extends Error {}

async function neonGet(path: string, apiKey: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${NEON_API}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new NeonApiError("Neon could not be reached.");
  }
  if (response.status === 401 || response.status === 403) throw new NeonApiError("Neon refused NEON_API_KEY (create a new key in the Neon console).");
  if (response.status === 404) throw new NeonApiError("Neon has no project with this ID for this API key.");
  if (response.status === 429) {
    const wait = Number(response.headers.get("retry-after"));
    throw new NeonApiError(`Neon's rate limit was reached; try again ${Number.isFinite(wait) && wait > 0 ? `in ${Math.ceil(wait)} seconds` : "in a few minutes"}.`);
  }
  if (!response.ok) throw new NeonApiError(`Neon answered ${response.status}.`);
  return response.json().catch(() => {
    throw new NeonApiError("Neon's answer was not readable.");
  });
}

const messageOf = (error: unknown) => (error instanceof NeonApiError ? error.message : "Neon's answer could not be read.");

/** One read per project plus its endpoints and branches; a failed project shows its error, never zero usage. */
export async function readNeonAccountUsage(): Promise<NeonAccountUsage> {
  const apiKey = process.env.NEON_API_KEY?.trim();
  const projectIds = parseProjectIds(process.env.NEON_PROJECT_ID);
  if (!apiKey || !projectIds.length) return { state: "not_configured" };
  let appEndpoint: string | null = null;
  try {
    appEndpoint = endpointIdOfHost(new URL(process.env.DATABASE_URL ?? "").hostname);
  } catch {
    appEndpoint = null;
  }

  const projects = await Promise.all(projectIds.map(async (id): Promise<NeonProjectResult> => {
    try {
      const project = parseNeonProject(id, await neonGet(`/projects/${id}`, apiKey));
      if (!project) return { ok: false, id, isAppProject: false, error: "Neon's answer had no project." };
      // The Free plan allows 10 branches a project, so one page of 100 holds them all.
      const [endpoints, branches] = await Promise.allSettled([
        neonGet(`/projects/${id}/endpoints`, apiKey),
        neonGet(`/projects/${id}/branches?limit=100`, apiKey),
      ]);
      const endpointError = endpoints.status === "rejected" ? messageOf(endpoints.reason) : null;
      if (endpoints.status === "fulfilled") project.endpoints = parseNeonEndpoints(endpoints.value);
      const branchError = branches.status === "rejected" ? messageOf(branches.reason) : null;
      if (branches.status === "fulfilled") {
        const sizes = parseNeonBranches(branches.value);
        project.storageBytes = sizes.bytes;
        project.branchCount = sizes.count;
      }
      const isAppProject = Boolean(appEndpoint && project.endpoints.some((endpoint) => endpoint.id === appEndpoint));
      return { ok: true, isAppProject, endpointError, branchError, ...project };
    } catch (error) {
      return { ok: false, id, isAppProject: false, error: messageOf(error) };
    }
  }));
  // One project whose endpoints could not be read is taken to be the app's; a mismatch is not.
  const only = projects.length === 1 ? projects[0] : null;
  if (only?.ok && only.endpointError) only.isAppProject = true;
  return { state: "checked", projects };
}
