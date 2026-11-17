"use server";

import { layoutThemeFromForm } from "@/app/pdf/layout-settings";
import { requireUser } from "@/lib/session";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";
import { saveTemplateStyle, type TemplateStyles } from "@/server/pdf/template-styles";
import { recordResumePageBid } from "@/server/bids/resume-page-bid";
import { revalidatePath } from "next/cache";

export type TemplateStyleResult = { ok: true; styles: TemplateStyles } | { ok: false; message: string };

/**
 * Saves the Resume page's layout settings as the signed-in Manager's style for one template (an
 * empty form removes it). That Manager's Generations then print with it.
 */
export async function saveTemplateStyleAction(template: string, form: Record<string, string>): Promise<TemplateStyleResult> {
  const user = await requireUser();
  if (user.role !== "manager") return { ok: false, message: "Only Managers can save template styles." };
  if (!isPdfTemplate(template)) return { ok: false, message: "Choose one of the QTS templates." };
  if (!form || typeof form !== "object") return { ok: false, message: "The style could not be read." };
  const strings = Object.fromEntries(Object.entries(form).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  try {
    return { ok: true, styles: await saveTemplateStyle(user.id, template, layoutThemeFromForm(strings)) };
  } catch (error) {
    console.error("Could not save the template style.", error);
    return { ok: false, message: "The style could not be saved. Try again." };
  }
}

export type ResumeBidResult = { message: string };

/**
 * After the Resume page saved both PDFs: records the application on the Bids page, without a job
 * URL. The message tells the Manager whether a bid was added.
 */
export async function recordResumeDownloadBidAction(input: {
  candidateEmail: string;
  candidateName: string;
  jobTitle: string;
  company: string;
  template: string;
  resumeFolder: string;
}): Promise<ResumeBidResult> {
  const user = await requireUser();
  if (user.role !== "manager") return { message: "No bid added: only Managers record bids." };
  const field = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const jobTitle = field(input?.jobTitle, 500);
  const company = field(input?.company, 500);
  if (!jobTitle || !company) return { message: "No bid added: the JSON has no job title or company." };
  if (!isPdfTemplate(input.template)) return { message: "No bid added: unknown template." };
  try {
    const result = await recordResumePageBid(user.id, {
      candidateEmail: field(input.candidateEmail, 320),
      candidateName: field(input.candidateName, 300),
      jobTitle,
      company,
      template: input.template,
      resumeFolder: field(input.resumeFolder, 2048),
    });
    if (result.status === "no-candidate") {
      return { message: "No bid added: none of your active candidates has this résumé's email or name." };
    }
    revalidatePath("/bids");
    return {
      message: result.status === "added"
        ? `Bid added for ${result.candidateName}: ${jobTitle} at ${company}.`
        : `Already in Bids for ${result.candidateName}: ${jobTitle} at ${company}.`,
    };
  } catch (error) {
    console.error("Could not record the Resume page bid.", error);
    return { message: "The PDFs were saved, but the bid could not be added. Try the download again." };
  }
}
