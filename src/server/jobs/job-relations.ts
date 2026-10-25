// Groups existing jobs rows into shared jobs for the relation_id backfill.
// Rows sharing a job_key or a title_company_key are the same job, transitively.

import { computeJobKey, computeTitleCompanyKey } from "./job-key";

export type JobRelationRow = {
  id: string;
  jobUrl: string;
  jobTitle: string;
  company: string;
  candidateId: string;
  managerId: string;
  relationId: string | null;
};

export type JobRelationUpdate = {
  id: string;
  relationId: string;
  jobKey: string | null;
  titleCompanyKey: string | null;
};

export type JobRelationPlan = {
  updates: JobRelationUpdate[];
  /** The same account twice in one job: must be resolved before the unique indexes are added. */
  collisions: { relationId: string; candidateId: string; rowIds: string[] }[];
  groupCount: number;
  mergedGroupCount: number;
  sharedAcrossManagersCount: number;
  rowsWithoutJobKey: string[];
  /** Groups that already held more than one relation_id; the first one is kept. */
  conflictingRelationIds: string[][];
};

/** Rows must be ordered oldest first so the oldest existing relation_id wins. */
export function planJobRelations(
  rows: JobRelationRow[],
  newRelationId: () => string,
): JobRelationPlan {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  const keys = new Map<string, { jobKey: string | null; titleCompanyKey: string | null }>();
  const firstRowByKey = new Map<string, string>();
  const rowsWithoutJobKey: string[] = [];
  for (const row of rows) {
    const jobKey = computeJobKey({ url: row.jobUrl, title: row.jobTitle, company: row.company });
    const titleCompanyKey = computeTitleCompanyKey(row.jobTitle, row.company) || null;
    keys.set(row.id, { jobKey, titleCompanyKey });
    find(row.id);
    if (!jobKey) rowsWithoutJobKey.push(row.id);
    for (const key of [jobKey && `url:${jobKey}`, titleCompanyKey && `tc:${titleCompanyKey}`]) {
      if (!key) continue;
      const first = firstRowByKey.get(key);
      if (first) union(first, row.id);
      else firstRowByKey.set(key, row.id);
    }
  }

  const groups = new Map<string, JobRelationRow[]>();
  for (const row of rows) {
    const root = find(row.id);
    groups.set(root, [...(groups.get(root) ?? []), row]);
  }

  const plan: JobRelationPlan = {
    updates: [],
    collisions: [],
    groupCount: groups.size,
    mergedGroupCount: 0,
    sharedAcrossManagersCount: 0,
    rowsWithoutJobKey,
    conflictingRelationIds: [],
  };
  for (const members of groups.values()) {
    const existing = [...new Set(members.map((row) => row.relationId).filter((id): id is string => Boolean(id)))];
    if (existing.length > 1) plan.conflictingRelationIds.push(existing);
    const relationId = existing[0] ?? newRelationId();
    if (members.length > 1) plan.mergedGroupCount += 1;
    if (new Set(members.map((row) => row.managerId)).size > 1) plan.sharedAcrossManagersCount += 1;
    const rowsByCandidate = new Map<string, string[]>();
    for (const row of members) {
      rowsByCandidate.set(row.candidateId, [...(rowsByCandidate.get(row.candidateId) ?? []), row.id]);
      plan.updates.push({ id: row.id, relationId, ...keys.get(row.id)! });
    }
    for (const [candidateId, rowIds] of rowsByCandidate) {
      if (rowIds.length > 1) plan.collisions.push({ relationId, candidateId, rowIds });
    }
  }
  return plan;
}
