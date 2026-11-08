import "server-only";

import { eq } from "drizzle-orm";
import { cleanLayoutTheme, type LayoutTheme } from "@/app/pdf/layout-settings";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";
import { readTemplateStyles, type TemplateStyles, templateStylesKey } from "@/server/pdf/template-style-values";

export { readTemplateStyles, templateStylesKey, type TemplateStyles, withTemplateStyle } from "@/server/pdf/template-style-values";

export async function loadTemplateStyles(managerId: string): Promise<TemplateStyles> {
  const [row] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, templateStylesKey(managerId))).limit(1);
  return readTemplateStyles(row?.value);
}

/** Saves (or, with an empty style, removes) one template's style; gives all of the Manager's styles. */
export async function saveTemplateStyle(managerId: string, template: PdfTemplate, style: LayoutTheme): Promise<TemplateStyles> {
  const styles = await loadTemplateStyles(managerId);
  const clean = cleanLayoutTheme(style);
  if (Object.keys(clean).length) styles[template] = clean;
  else delete styles[template];
  const key = templateStylesKey(managerId);
  if (Object.keys(styles).length) {
    await db.insert(settings)
      .values({ key, value: styles, updatedByUserId: managerId })
      .onConflictDoUpdate({ target: settings.key, set: { value: styles, updatedByUserId: managerId, updatedAt: new Date() } });
  } else {
    await db.delete(settings).where(eq(settings.key, key));
  }
  return styles;
}
