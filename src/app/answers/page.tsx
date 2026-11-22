import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnswersList, type AnswerRow } from "@/app/answers/answers-list";
import { PageHeader } from "@/app/ui/page-header";
import { requireUser } from "@/lib/session";
import { alternativesOf } from "@/server/apply/answer-variant-forms";
import { listManagerAnswers } from "@/server/apply/manager-answers";

export const instant = false;

export const metadata: Metadata = {
  title: "Answers | QTS",
};

// The Manager's reusable answers, kept by hand: one line per question with all its answers. Every
// answer is for all candidates and every job; Apply and Auto Apply fill each question they match.
export default async function AnswersPage() {
  const user = await requireUser();
  if (user.role !== "manager") redirect("/");
  const rows: AnswerRow[] = (await listManagerAnswers(user.id)).map((row) => ({
    id: row.id,
    version: row.version,
    question: row.questionText,
    answers: [row.answer, ...alternativesOf(row.variants ?? []).filter((other) => other.toLowerCase() !== row.answer.toLowerCase())],
  }));

  return (
    <main className="mx-auto max-w-5xl py-1">
      <PageHeader
        description="Write a question once with its answers. Apply and Auto Apply fill it for every candidate and job. The first answer is the main one; the others are tried when a form's choices need different words."
        title="Answers"
      />
      <AnswersList rows={rows} />
    </main>
  );
}
