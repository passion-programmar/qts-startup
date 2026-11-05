import { NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { neonSql } from "@/lib/db";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { answerAttemptQuery, editAnswerQuery, parseAnswerEdit } from "@/server/apply/manager-answer-editor";
import { loadApplicationAnswers } from "@/server/apply/manager-answers";
import { profileField } from "@/server/apply/manager-answer-values";

const dialect = new PgDialect();
const reply = (status: number, message: string) => NextResponse.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) { auth.headers.set("Cache-Control", "no-store"); return auth; }
  try {
    const text = await request.text();
    if (text.length > 64000) return reply(400, "The answer request is too large.");
    const body = JSON.parse(text);
    if (!isUuid(body?.attemptId) || !["load", "save", "delete"].includes(body?.action)) return reply(400, "A valid application and answer action are required.");
    const owner = { managerId: auth.manager.id, browserId: auth.browser.id, authVersion: auth.manager.authVersion };
    const context = dialect.sqlToQuery(answerAttemptQuery(owner, body.attemptId));
    const [held] = await neonSql.query(context.sql, context.params) as { candidateId: string; jobId: string; profile?: Record<string, string | null> }[];
    if (!held) return reply(409, "This application is no longer held by this Chrome.");
    let profileUpdate = null;
    if (body.action !== "load") {
      const parsed = parseAnswerEdit({ ...body.answer, action: body.action });
      if (typeof parsed === "string") return reply(400, parsed);
      const query = dialect.sqlToQuery(editAnswerQuery(owner, body.attemptId, parsed));
      const changed = await neonSql.query(query.sql, query.params);
      if (!changed.length) return reply(409, "The saved answer or application changed. Reload answers and review again; nothing was overwritten.");
      if (parsed.action === "save" && parsed.profileField && changed[0].scope === "candidate") profileUpdate = { field: parsed.profileField, value: parsed.answer };
    }
    const editableAnswers = await loadApplicationAnswers(owner.managerId, held.candidateId, held.jobId, true);
    const answers = editableAnswers.filter((row) => row.scope !== "candidate" || !profileField(row.questionText));
    return NextResponse.json({ success: true, savedAnswers: answers, editableAnswers, candidateProfile: held.profile, profileUpdate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return reply(400, "Invalid answer request.");
    if (["40001", "40P01", "55P03", "23505"].includes((error as { code?: string }).code || "")) return reply(409, "The answer or application is being changed. Reload answers before retrying.");
    console.error("Could not confirm Manager answer edit.", error instanceof Error ? error.name : "unknown");
    return reply(500, "The answer change could not be confirmed. Reload answers before retrying.");
  }
}
