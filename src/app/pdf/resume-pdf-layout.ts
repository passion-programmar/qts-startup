import type { DocumentTheme } from "@/app/pdf/document-data";
import { cleanLayoutTheme } from "@/app/pdf/layout-settings";

// PDF coordinates and text sizes use points; margins below remain in millimetres
// until the writer converts them. Keep the automatic stages in render.js order.
export type ResumePdfLayout = {
  nameSize: number; headlineSize: number; contactSize: number; sectionSize: number;
  itemSize: number; bodySize: number; bulletSize: number; metaSize: number;
  sectionGap: number; itemGap: number; titleGap: number; headerGap: number;
  bulletGap: number; lineHeight: number;
  marginTop: number; marginSide: number; marginBottom: number;
  paper: "A4" | "letter";
};

export function resumePdfLayouts(theme: DocumentTheme = {}, template = ""): {
  target: number;
  layouts: ResumePdfLayout[];
} {
  const saved = cleanLayoutTheme(theme);
  const number = (key: string, fallback: number) => typeof saved[key] === "number" ? saved[key] as number : fallback;
  const scale = number("fontScale", 1);
  const size = (key: string, fallback: number) => number(key, fallback) * scale;
  const normal: ResumePdfLayout = {
    nameSize: size("nameSize", 24), headlineSize: size("headlineSize", 12),
    contactSize: size("contactSize", 10.5), sectionSize: size("sectionSize", 12.5),
    itemSize: size("itemSize", 11.5), bodySize: size("bodySize", 11),
    bulletSize: size("bulletSize", 11), metaSize: size("metaSize", 10.5),
    sectionGap: number("sectionGap", 8), itemGap: number("itemGap", 8),
    titleGap: number("titleGap", 4), headerGap: number("headerGap", 10),
    bulletGap: number("bulletGap", 1), lineHeight: number("lineHeight", 1.3),
    marginTop: number("marginTop", 15), marginSide: number("marginSide", 16),
    marginBottom: number("marginBottom", 10), paper: saved.paper === "letter" ? "letter" : "A4",
  };
  const target = /^[1-5]$/.test(String(saved.fitPages)) ? Number(saved.fitPages) : 2;
  if (saved.density === "normal") return { target, layouts: [normal] };
  if (saved.density === "compact") {
    const nordic = template === "nordic";
    // Explicit compact mode is separate from automatic fitting, as in base.css.
    const compact = { ...normal,
      lineHeight: Math.min(normal.lineHeight, nordic ? 1.2 : 1.27),
      headerGap: Math.min(normal.headerGap, nordic ? 6 : 8),
      sectionGap: Math.min(normal.sectionGap, nordic ? 6 : 8),
      titleGap: Math.min(normal.titleGap, nordic ? 2 : 3),
      itemGap: Math.min(normal.itemGap, nordic ? 5 : 7),
      bulletGap: Math.min(normal.bulletGap, nordic ? 0 : 0.5),
    };
    if (nordic) {
      for (const key of ["nameSize", "headlineSize", "contactSize", "sectionSize", "itemSize", "bodySize", "bulletSize", "metaSize"] as const) {
        compact[key] *= 0.97 / scale;
      }
    }
    return { target, layouts: [compact] };
  }
  const floor = Math.max(10.5, number("minTextSize", 10.5));
  const font = { ...normal, bodySize: Math.min(normal.bodySize, floor), bulletSize: Math.min(normal.bulletSize, floor) };
  const sections = { ...font, sectionGap: Math.min(font.sectionGap, 6), bulletGap: 1 };
  const lines = { ...sections, lineHeight: Math.min(sections.lineHeight, 1.25) };
  const margins = { ...lines, marginSide: Math.min(lines.marginSide, 14) };
  return { target, layouts: [normal, font, sections, lines, margins] };
}
