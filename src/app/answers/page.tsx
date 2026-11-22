import type { Metadata } from "next";
import { MessageSquareText } from "lucide-react";
import { redirect } from "next/navigation";
import { ManagerAnswers } from "@/app/profile/manager-answers";
import { Card, CardHeader } from "@/app/ui/card";
import { PageHeader } from "@/app/ui/page-header";
import { requireUser } from "@/lib/session";
import { listManagerAnswers } from "@/server/apply/manager-answers";

export const instant = false;

export const metadata: Metadata = {
  title: "Answers | QTS",
};

// The Manager's reusable answers, added and edited by hand here: Apply and Auto Apply fill the
// questions they match on every application.
export default async function AnswersPage() {
  const user = await requireUser();
  if (user.role !== "manager") redirect("/");
  const rows = await listManagerAnswers(user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-5 py-1">
      <PageHeader
        description="Answers you write once for your candidates. Apply and Auto Apply fill every question they match."
        title="Answers"
      />
      <Card>
        <CardHeader
          className="mb-6 border-b border-line-soft pb-4"
          description="Add a question and its answer, then Save. Write the answer as forms show it (for a choice, the choice's own words)."
          icon={<MessageSquareText />}
          title="Reusable answers"
        />
        <ManagerAnswers rows={rows} />
      </Card>
    </main>
  );
}
