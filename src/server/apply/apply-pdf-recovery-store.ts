import "server-only";

import { PgDialect } from "drizzle-orm/pg-core";
import { neonSql } from "@/lib/db";
import { pdfParent, recoveryContextQuery, relinkUpdateQuery, type RecoveryContext, type RecoveryOwner, type RelinkInput } from "./apply-pdf-recovery";

const dialect = new PgDialect();

export async function loadPdfRecoveryContext(owner: RecoveryOwner, attemptId: string): Promise<RecoveryContext | null> {
  const query = dialect.sqlToQuery(recoveryContextQuery(owner, attemptId));
  const [row] = await neonSql.query(query.sql, query.params) as RecoveryContext[];
  return row && pdfParent(row.resumePath) && !row.coverLetterPath ? row : null;
}

export async function relinkPdfPaths(owner: RecoveryOwner, input: RelinkInput): Promise<boolean> {
  const lock = dialect.sqlToQuery(recoveryContextQuery(owner, input.attemptId, true));
  const update = dialect.sqlToQuery(relinkUpdateQuery(owner, input));
  try {
    // neon-http cannot run an interactive db.transaction(). All statements go in one HTTP transaction.
    const [, result] = await neonSql.transaction([
      neonSql.query(lock.sql, lock.params), neonSql.query(update.sql, update.params),
    ], { isolationLevel: "Serializable" });
    return result.length === 1;
  } catch (error) {
    const code = (error as { code?: string }).code;
    // Never automatically retry a write against a changed authorization/path snapshot.
    if (code === "40001" || code === "40P01" || code === "55P03") return false;
    throw error;
  }
}
