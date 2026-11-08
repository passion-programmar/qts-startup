"use server";

import { layoutThemeFromForm } from "@/app/pdf/layout-settings";
import { requireUser } from "@/lib/session";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";
import { saveTemplateStyle, type TemplateStyles } from "@/server/pdf/template-styles";

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
