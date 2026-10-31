import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CoverLetterDocument,
  DocumentBullet,
  PdfPackage,
  ResumeDocument,
} from "@/app/pdf/document-data";
import { DocumentPageLimitError } from "@/app/pdf/document-page-limit-error";
import { orderResumeSections } from "@/app/pdf/resume-sections";
import {
  pdfTemplateDesigns,
  type PdfTemplate,
  type LegacyPdfTemplate,
} from "@/server/pdf/pdf-templates";
import type { PDFFont, PDFPage } from "pdf-lib";

type PdfWriter = {
  header(title: string, detail: string, size?: number): void;
  line(text: string, size?: number, color?: "black" | "gray"): void;
  heading(text: string, size?: number): void;
  paragraph(text: string, size?: number): void;
  section(text: string, minimumContentHeight?: number): void;
  skillsHeight(items: ResumeSectionItem[]): number;
  skills(items: ResumeSectionItem[]): void;
  entry(
    heading: string,
    dateRange?: string,
    subheading?: string,
    bullets?: string[],
    hasFollowingEntry?: boolean,
  ): void;
  centeredLine(text: string, size?: number): void;
  space(amount: number): void;
  save(): Promise<Uint8Array>;
};

type ResumeSectionItem = ResumeDocument["sections"][number]["items"][number];
type PdfDrawTextOptions = NonNullable<Parameters<PDFPage["drawText"]>[1]>;

const romanianCharacters = new Set([
  "\u0102", "\u0103", "\u00C2", "\u00E2", "\u00CE",
  "\u00EE", "\u0218", "\u0219", "\u021A", "\u021B",
]);

type RomanianFallbackFonts = {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
};

let romanianFallbackFontsPromise: Promise<RomanianFallbackFonts> | undefined;

function loadRomanianFallbackFonts(): Promise<RomanianFallbackFonts> {
  romanianFallbackFontsPromise ??= Promise.all([
    readFile(path.join(process.cwd(), "public", "resume-templates", "fonts", "noto-sans", "NotoSans-Regular.ttf")),
    readFile(path.join(process.cwd(), "public", "resume-templates", "fonts", "noto-sans", "NotoSans-Bold.ttf")),
    readFile(path.join(process.cwd(), "public", "resume-templates", "fonts", "noto-sans", "NotoSans-Italic.ttf")),
  ]).then(([regular, bold, italic]) => ({ regular, bold, italic }));
  return romanianFallbackFontsPromise;
}

function containsRomanianCharacters(document: object): boolean {
  return [...(JSON.stringify(document) ?? "")].some((character) => romanianCharacters.has(character));
}

function pdfBulletText(bullet: DocumentBullet): string {
  const text = typeof bullet === "string"
    ? bullet
    : bullet.detail
      ? `${bullet.name} (${bullet.detail})`
      : bullet.name;
  return text.replaceAll("**", "");
}

export async function renderPdfPackage(
  data: PdfPackage,
  template: PdfTemplate,
): Promise<{ resume: Uint8Array; coverLetter: Uint8Array }> {
  // The same sections, in the same order, as the HTML template would print.
  const resumeForTemplate = {
    ...data.resume,
    sections: orderResumeSections(data.resume.sections, template),
  };
  const [resume, coverLetter] = await Promise.all([
    renderResumePdf(resumeForTemplate, template),
    renderCoverLetterPdf(data.coverLetter, template),
  ]);
  return { resume, coverLetter };
}

async function renderResumePdf(
  document: ResumeDocument,
  template: PdfTemplate | LegacyPdfTemplate,
): Promise<Uint8Array> {
  const pdf = await createWriter(template, 3, containsRomanianCharacters(document));
  const headline = document.candidate.headline ?? document.targetRole;
  const contactParts = template === "flowcv" ? [
    document.candidate.location,
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
  ] : [
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
    document.candidate.location,
  ];
  const contact = template === "flowcv"
    ? contactParts.map((value) => value ?? "").join(" | ")
    : contactParts.filter(Boolean).join("  |  ");
  pdf.header(document.candidate.fullName, [
    ...(template === "vellum" ? [headline] : [headline, contact]),
  ].filter(Boolean).join(template === "flowcv" ? "\n" : " | "), 19);
  if (template === "vellum" && contact) pdf.centeredLine(contact, 8.5);
  if (document.summary) {
    pdf.section(["vellum", "flowcv"].includes(template) ? "Summary" : "Professional Summary");
    pdf.paragraph(document.summary);
  }
  for (const section of document.sections) {
    const skillsSection = section.type === "skills";
    pdf.section(
      section.title,
      skillsSection ? pdf.skillsHeight(section.items) : 42,
    );
    if (skillsSection) {
      pdf.skills(section.items);
      continue;
    }
    const projects = section.id === "projects";
    section.items.forEach((item, index) => {
      // The role alone, so an ATS reads it as the job title; the skills are in the Skills section.
      pdf.entry(
        item.heading ?? "",
        item.dateRange,
        projects
          ? (item.focus?.length ? `Technologies: ${item.focus.join(", ")}` : undefined)
          : [item.subheading, item.location, item.workMode].filter(Boolean).join(" · ") || undefined,
        (item.bullets ?? []).map(pdfBulletText),
        index < section.items.length - 1,
      );
    });
  }
  return pdf.save();
}

async function renderCoverLetterPdf(
  document: CoverLetterDocument,
  template: PdfTemplate | LegacyPdfTemplate,
): Promise<Uint8Array> {
  const pdf = await createWriter(template, 1, containsRomanianCharacters(document));
  const coverContactParts = [
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
  ];
  const coverContact = template === "flowcv"
    ? ["", ...coverContactParts].map((value) => value ?? "").join(" | ")
    : coverContactParts.filter(Boolean).join(" | ");
  pdf.header(
    document.candidate.fullName,
    template === "flowcv" ? `\n${coverContact}` : coverContact,
    17,
  );
  pdf.space(22);
  pdf.line(
    document.date
      ?? new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date()),
    10,
  );
  pdf.space(16);
  pdf.line(document.salutation ?? "Dear Hiring Manager,", 11);
  pdf.space(8);
  for (const paragraph of document.bodyParagraphs) {
    pdf.paragraph(paragraph, 11);
    pdf.space(8);
  }
  pdf.line(document.closing ?? "Sincerely,", 11);
  pdf.space(15);
  pdf.heading(document.signatureName ?? document.candidate.fullName, 11);
  return pdf.save();
}

async function createWriter(
  template: PdfTemplate | LegacyPdfTemplate,
  maxPages: number,
  needsRomanianFallback: boolean,
): Promise<PdfWriter> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const design = pdfTemplateDesigns[template];
  const isFlowCv = template === "flowcv";
  const fontNames = design.font === "serif"
    ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold]
    : design.font === "mono"
      ? [StandardFonts.Courier, StandardFonts.CourierBold]
      : [StandardFonts.Helvetica, StandardFonts.HelveticaBold];
  let regular: PDFFont;
  let bold: PDFFont;
  let italic: PDFFont;
  let romanianFonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont } | null = null;
  if (isFlowCv || needsRomanianFallback) {
    const { default: fontkit } = await import("@pdf-lib/fontkit");
    document.registerFontkit(fontkit);
  }
  if (isFlowCv) {
    const { loadAlegreyaFonts } = await import("@/app/pdf/alegreya-fonts");
    const fonts = await loadAlegreyaFonts();
    [regular, bold, italic] = await Promise.all([
      document.embedFont(fonts.regular, { subset: true }),
      document.embedFont(fonts.bold, { subset: true }),
      document.embedFont(fonts.italic, { subset: true }),
    ]);
  } else {
    regular = await document.embedFont(fontNames[0]);
    bold = await document.embedFont(fontNames[1]);
    italic = await document.embedFont(
      design.font === "serif" ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique,
    );
  }
  if (needsRomanianFallback) {
    const fonts = await loadRomanianFallbackFonts();
    const [romanianRegular, romanianBold, romanianItalic] = await Promise.all([
      document.embedFont(fonts.regular, { subset: true }),
      document.embedFont(fonts.bold, { subset: true }),
      document.embedFont(fonts.italic, { subset: true }),
    ]);
    romanianFonts = {
      regular: romanianRegular,
      bold: romanianBold,
      italic: romanianItalic,
    };
  }
  const width = 595.28;
  const height = 841.89;
  const accent = rgb(...design.accent);
  const ink = rgb(...design.ink);
  const muted = rgb(...design.muted);
  const margin = design.margin;
  const bodyLeading = isFlowCv ? 13.5 : 13.8;
  const bulletLeading = isFlowCv ? 13.5 : 13;
  const isLedgerResume = template === "ledger" && maxPages > 1;
  const bulletGap = isFlowCv ? 0 : isLedgerResume ? 1.5 : 2.5;
  const entryGap = isFlowCv ? 7 : isLedgerResume ? 9 : design.compact ? 10 : 12;
  const sectionBefore = isFlowCv ? 14.25 : isLedgerResume ? 8 : design.compact ? 8 : 10;
  const sectionAfter = isFlowCv ? 8.5 : isLedgerResume ? 7 : design.compact ? 8 : 9;
  let page = document.addPage([width, height]);
  let y = height - margin;
  const clean = (text: string) => isFlowCv
    ? text.normalize("NFC")
      .replaceAll("â€“", "–")
      .replaceAll("â€”", "—")
      .replaceAll("â€™", "’")
      .replaceAll("â€œ", "“")
      .replaceAll("â€", "”")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
    : text.normalize("NFC")
    .replace(/[—−]/g, "–")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2022\u0102\u0103\u0218-\u021B]/g, "?");
  const fontRuns = (text: string, font: PDFFont) => {
    const runs: { text: string; font: PDFFont }[] = [];
    for (const character of text) {
      const nextFont = romanianFonts && romanianCharacters.has(character)
        ? font === bold
          ? romanianFonts.bold
          : font === italic
            ? romanianFonts.italic
            : romanianFonts.regular
        : font;
      const lastRun = runs.at(-1);
      if (lastRun?.font === nextFont) lastRun.text += character;
      else runs.push({ text: character, font: nextFont });
    }
    return runs;
  };
  const measureText = (text: string, size: number, font: PDFFont = regular) =>
    fontRuns(text, font).reduce(
      (widthAtSize, run) => widthAtSize + run.font.widthOfTextAtSize(run.text, size),
      0,
    );
  const drawText = (
    text: string,
    options: PdfDrawTextOptions,
  ) => {
    const primaryFont = options.font ?? regular;
    const runs = fontRuns(text, primaryFont);
    if (runs.length === 1 && runs[0].font === primaryFont) {
      page.drawText(text, options);
      return;
    }
    const maxWidth = options.maxWidth;
    let x = options.x ?? 0;
    const size = options.size ?? 12;
    for (const run of runs) {
      page.drawText(run.text, {
        ...options,
        x,
        font: run.font,
        ...(maxWidth === undefined ? {} : { maxWidth: Math.max(0, maxWidth - (x - (options.x ?? 0))) }),
      });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  const ensure = (needed = 18) => {
    if (y < margin + needed) {
      if (document.getPageCount() >= maxPages) {
        throw new DocumentPageLimitError(maxPages === 1
          ? "The cover letter exceeds one A4 page. Shorten its paragraphs."
          : `The résumé exceeds ${maxPages} A4 pages. Its content was not truncated.`);
      }
      page = document.addPage([width, height]);
      y = height - margin;
    }
  };
  const wrap = (
    text: string,
    size: number,
    maxWidth: number,
    font: typeof regular = regular,
  ) => {
    const words = clean(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measureText(next, size, font) <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const wrapWithFirstLineWidth = (
    text: string,
    size: number,
    firstLineWidth: number,
    remainingLineWidth: number,
    font: PDFFont = regular,
  ) => {
    const words = clean(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      const availableWidth = lines.length === 0 ? firstLineWidth : remainingLineWidth;
      if (measureText(next, size, font) <= availableWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const drawWrapped = (
    text: string,
    size = 10,
    color: "black" | "gray" = "black",
    centered = false,
    inset = 0,
  ) => {
    for (const part of wrap(text, size, width - margin * 2 - inset * 2)) {
      ensure(size + 5);
      const textWidth = measureText(part, size);
      drawText(part, {
        x: centered ? Math.max(margin, (width - textWidth) / 2) : margin + inset,
        y,
        size,
        font: regular,
        color: color === "gray" ? muted : ink,
      });
      y -= isFlowCv ? bodyLeading : size === 10 ? bodyLeading : Math.max(size * 1.35, size + 3);
    }
  };
  const line = (text: string, size = 10, color: "black" | "gray" = "black") => {
    drawWrapped(text, size, color, false);
  };
  const heading = (text: string, size = 12) => {
    ensure(size + 7);
    const cleaned = clean(text);
    const textWidth = measureText(cleaned, size, bold);
    drawText(clean(text), {
      x: design.align === "center" ? Math.max(margin, (width - textWidth) / 2) : margin,
      y,
      size,
      font: bold,
      color: accent,
      maxWidth: width - margin * 2,
    });
      y -= Math.max(size * 1.35, size + 4);
  };
  const centeredLine = (text: string, size = 10) => {
    drawWrapped(text, size, "gray", true);
  };
  const drawFlowCvContactRow = (text: string, preferredSize: number) => {
    const items = text.split(/\s*\|\s*/).map((value, iconIndex) => ({
      value,
      iconIndex,
    })).filter((item) => Boolean(item.value));
    const iconSize = 8;
    const iconTextGap = 4;
    const itemGap = 13;
    const availableWidth = width - margin * 2;
    const measure = (fontSize: number) => items.reduce(
      (total, item) => total + iconSize + iconTextGap
        + measureText(clean(item.value), fontSize),
      Math.max(0, items.length - 1) * itemGap,
    );
    let fontSize = preferredSize;
    if (measure(fontSize) > availableWidth) {
      fontSize = Math.max(8.5, fontSize * availableWidth / measure(fontSize));
    }
    const rowWidth = measure(fontSize);
    let x = Math.max(margin, (width - rowWidth) / 2);
    items.forEach((item) => {
      drawFlowCvContactIcon(item.iconIndex, x, y + 1, iconSize);
      x += iconSize + iconTextGap;
      const cleaned = clean(item.value);
      drawText(cleaned, { x, y, size: fontSize, font: regular, color: ink });
      x += measureText(cleaned, fontSize) + itemGap;
    });
  };
  const drawFlowCvContactIcon = (
    index: number,
    x: number,
    iconY: number,
    size: number,
  ) => {
    if (index === 0) {
      page.drawCircle({
        x: x + size / 2,
        y: iconY + size * .62,
        size: size * .32,
        borderColor: ink,
        borderWidth: 1.2,
      });
      page.drawCircle({ x: x + size / 2, y: iconY + size * .62, size: 1.15, color: ink });
      page.drawLine({
        start: { x: x + size * .3, y: iconY + size * .42 },
        end: { x: x + size / 2, y: iconY },
        thickness: 1.2,
        color: ink,
      });
      page.drawLine({
        start: { x: x + size * .7, y: iconY + size * .42 },
        end: { x: x + size / 2, y: iconY },
        thickness: 1.2,
        color: ink,
      });
      return;
    }
    if (index === 1) {
      page.drawRectangle({ x, y: iconY + .5, width: size, height: size * .68, borderColor: ink, borderWidth: 1.1 });
      page.drawLine({ start: { x, y: iconY + size * .68 }, end: { x: x + size / 2, y: iconY + size * .32 }, thickness: 1, color: ink });
      page.drawLine({ start: { x: x + size, y: iconY + size * .68 }, end: { x: x + size / 2, y: iconY + size * .32 }, thickness: 1, color: ink });
      return;
    }
    if (index === 2) {
      page.drawLine({ start: { x: x + 1, y: iconY + size }, end: { x: x + 2.5, y: iconY + 2 }, thickness: 2.2, color: ink });
      page.drawLine({ start: { x: x + 2.5, y: iconY + 2 }, end: { x: x + size - 1, y: iconY + .5 }, thickness: 2.2, color: ink });
      return;
    }
    page.drawRectangle({ x, y: iconY, width: size, height: size, color: ink });
    page.drawText("in", {
      x: x + 1.25,
      y: iconY + 1.6,
      size: 5.2,
      font: bold,
      color: rgb(1, 1, 1),
    });
  };
  const header = (title: string, detail: string, size = 19) => {
    if (template === "flowcv") {
      const nameSize = 22;
      const headlineSize = 16;
      const contactSize = 11;
      ensure(102);
      const cleanedTitle = clean(title);
      const titleWidth = measureText(cleanedTitle, nameSize, bold);
      drawText(cleanedTitle, {
        x: Math.max(margin, (width - titleWidth) / 2),
        y,
        size: nameSize,
        font: bold,
        color: ink,
      });
      y -= 23.25;
      const [headline = "", contact = ""] = detail.split("\n", 2);
      if (headline) {
        for (const part of wrap(headline, headlineSize, width - margin * 2, italic)) {
          const partWidth = measureText(part, headlineSize, italic);
          drawText(part, {
            x: Math.max(margin, (width - partWidth) / 2),
            y,
            size: headlineSize,
            font: italic,
            color: ink,
          });
          y -= 19;
        }
        y -= 6.5;
      }
      if (contact) {
        drawFlowCvContactRow(contact, contactSize);
        y -= 18;
      }
      return;
    }
    if (template === "vellum") {
      ensure(size + 42);
      page.drawLine({
        start: { x: margin, y: y + 22 },
        end: { x: width - margin, y: y + 22 },
        thickness: 0.55,
        color: muted,
      });
      const titleWidth = measureText(clean(title), size, bold);
      drawText(clean(title), {
        x: Math.max(margin, (width - titleWidth) / 2),
        y,
        size,
        font: bold,
        color: ink,
        maxWidth: width - margin * 2,
      });
      y -= size + 9;
      if (detail) {
        for (const part of wrap(detail, 10, width - margin * 2)) {
          ensure(15);
          const textWidth = measureText(part, 10);
          drawText(part, {
            x: Math.max(margin, (width - textWidth) / 2),
            y,
            size: 10,
            font: regular,
            color: muted,
            maxWidth: width - margin * 2,
          });
          y -= 13;
        }
      }
      page.drawLine({
        start: { x: margin, y: y - 1 },
        end: { x: width - margin, y: y - 1 },
        thickness: 1.15,
        color: ink,
      });
      page.drawLine({
        start: { x: margin, y: y - 4 },
        end: { x: width - margin, y: y - 4 },
        thickness: 0.45,
        color: ink,
      });
      y -= 16;
      return;
    }
    const headerTop = y + 16;
    const blockHeight = detail ? 68 : 48;
    const darkHeader = design.header === "band" || design.header === "card";
    const headerFill = template === "amber-crest"
        ? rgb(.07, .12, .22)
        : template === "terminal"
          ? rgb(.08, .11, .14)
          : template === "onyx"
            ? rgb(.12, .13, .15)
            : accent;
    if (design.header === "band" || design.header === "soft" || design.header === "card") {
      const x = design.header === "card" ? margin - 10 : 0;
      const blockWidth = design.header === "card" ? width - (margin - 10) * 2 : width;
      page.drawRectangle({
        x,
        y: headerTop - blockHeight,
        width: blockWidth,
        height: blockHeight,
        color: design.header === "soft" ? rgb(.93, .95, .97) : headerFill,
      });
    }
    const cleanedTitle = clean(title);
    const titleWidth = measureText(cleanedTitle, size, bold);
    const centered = design.align === "center";
    drawText(cleanedTitle, {
      x: centered ? Math.max(margin, (width - titleWidth) / 2) : margin,
      y,
      size,
      font: bold,
      color: darkHeader && !["onyx", "amber-crest", "terminal"].includes(template)
        ? rgb(1, 1, 1)
        : accent,
      maxWidth: width - margin * 2,
    });
    y -= size + 9;
    for (const part of wrap(detail, 9, width - margin * 2)) {
      const detailWidth = measureText(part, 9);
      drawText(part, {
        x: centered ? Math.max(margin, (width - detailWidth) / 2) : margin,
        y,
        size: 9,
        font: regular,
        color: darkHeader ? rgb(.92, .94, .97) : muted,
      });
      y -= 12;
    }
    if (design.header === "rule" || design.header === "double-rule") {
      const ruleCount = design.header === "double-rule" ? 2 : 1;
      for (let index = 0; index < ruleCount; index += 1) {
        page.drawLine({ start: { x: margin, y: y - index * 3 }, end: { x: width - margin, y: y - index * 3 }, thickness: index ? .5 : 1.2, color: accent });
      }
      y -= ruleCount === 2 ? 8 : 5;
    }
    y -= design.compact ? 5 : 9;
    if (design.header === "band" || design.header === "soft" || design.header === "card") {
      y = Math.min(y, headerTop - blockHeight - 8);
    }
  };
  const paragraph = (text: string, size = isFlowCv ? 11 : 10) => line(text, size);
  const section = (text: string, minimumContentHeight = 42) => {
    y -= sectionBefore;
    ensure(24 + minimumContentHeight);
    const layout = design.sectionHeadingLayout;
    const label = clean(text.toUpperCase());
    const labelSize = isFlowCv ? 14 : 10.5;
    const labelWidth = measureText(label, labelSize, bold);
    if (isFlowCv) {
      drawText(label, {
        x: margin,
        y,
        size: labelSize,
        font: bold,
        color: ink,
      });
      page.drawLine({
        start: { x: margin, y: y - 4.5 },
        end: { x: width - margin, y: y - 4.5 },
        thickness: 1.5,
        color: ink,
      });
      y -= 22.5;
      return;
    }
    if (layout === "centered-rules") {
      const center = width / 2;
      const gap = 8;
      const labelLeft = center - labelWidth / 2;
      const labelRight = center + labelWidth / 2;
      page.drawLine({
        start: { x: margin, y: y + 3 },
        end: { x: Math.max(margin, labelLeft - gap), y: y + 3 },
        thickness: 0.55,
        color: muted,
      });
      page.drawLine({
        start: { x: Math.min(width - margin, labelRight + gap), y: y + 3 },
        end: { x: width - margin, y: y + 3 },
        thickness: 0.55,
        color: muted,
      });
      drawText(label, {
        x: labelLeft,
        y,
        size: labelSize,
        font: bold,
        color: ink,
      });
      y -= 10.5 + sectionAfter;
      return;
    }
    if (layout === "band" || layout === "card") {
      page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 18, color: layout === "card" ? rgb(.94, .95, .97) : accent });
    } else if (layout === "pill") {
      page.drawRectangle({ x: margin, y: y - 4, width: labelWidth + 22, height: 18, color: rgb(.91, .94, .97) });
    } else if (layout === "marker") {
      page.drawRectangle({ x: margin, y: y - 2, width: 5, height: 14, color: accent });
    }
    drawText(label, {
      x: margin + (layout === "marker" ? 12 : layout === "pill" ? 10 : 0),
      y,
      size: labelSize,
      font: bold,
      color: layout === "band" ? rgb(1, 1, 1) : accent,
    });
    if (layout === "left-full-rule") {
      page.drawLine({
        start: { x: Math.min(width - margin, margin + labelWidth + 12), y: y + 3 },
        end: { x: width - margin, y: y + 3 },
        thickness: .8,
        color: accent,
      });
      y -= labelSize + sectionAfter;
      return;
    }
    if (layout === "compact-underline") {
      page.drawLine({
        start: { x: margin, y: y - 4 },
        end: { x: Math.min(width - margin, margin + labelWidth + 16), y: y - 4 },
        thickness: 1.1,
        color: accent,
      });
      y -= labelSize + sectionAfter;
      return;
    }
    y -= 14;
    if (layout === "rule" || layout === "double-rule") {
      page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: isFlowCv ? 1.5 : 1, color: accent });
      if (layout === "double-rule") page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .4, color: accent });
      y -= layout === "double-rule" ? sectionAfter + 3 : sectionAfter;
    } else {
      y -= sectionAfter;
    }
  };
  const entry = (
    title: string,
    dateRange?: string,
    subheading?: string,
    bullets: string[] = [],
    hasFollowingEntry = false,
  ) => {
    const titleSize = isFlowCv ? 11 : 10.5;
    const detailSize = isFlowCv ? 11 : 9;
    const titleLeading = isFlowCv ? 13.5 : 14.2;
    const bulletSize = isFlowCv ? 11 : 9.5;
    const cleanedDate = dateRange
      ? clean(dateRange).replace(/\s+(?:\?|-)\s+/g, " – ")
      : "";
    const dateWidth = cleanedDate
      ? measureText(cleanedDate, detailSize)
      : 0;
    const titleWidth = width - margin * 2 - dateWidth - (dateWidth ? 12 : 0);
    const titleLines = title ? wrap(title, titleSize, titleWidth) : [];
    const firstBulletLines = bullets[0]
      ? wrap(
        bullets[0],
        bulletSize,
        width - margin * 2 - (isFlowCv ? 10 : 22),
      ).length
      : 0;
    ensure(
      Math.max(34, titleLines.length * titleLeading + (subheading ? 13 : 0)
        + Math.min(firstBulletLines, 2) * bulletLeading),
    );

    if (titleLines.length || cleanedDate) {
      const rowY = y;
      titleLines.forEach((part, index) => {
        drawText(part, {
          x: margin,
          y: rowY - index * titleLeading,
          size: titleSize,
          font: template === "vellum" ? regular : bold,
          color: ink,
          maxWidth: index === 0 ? titleWidth : width - margin * 2,
        });
      });
      if (cleanedDate) {
        drawText(cleanedDate, {
          x: width - margin - dateWidth,
          y: rowY,
          size: detailSize,
          font: regular,
          color: template === "flowcv" ? ink : muted,
        });
      }
      y -= Math.max(1, titleLines.length) * titleLeading;
    }
    if (subheading) {
      for (const part of wrap(subheading, detailSize, width - margin * 2)) {
        drawText(part, {
          x: margin,
          y,
          size: detailSize,
          font: template === "flowcv" ? italic : regular,
          color: template === "flowcv" ? ink : muted,
        });
        y -= isFlowCv ? 13.5 : 12.2;
      }
      if (!isFlowCv) y -= 3.5;
    } else if (titleLines.length || cleanedDate) {
      if (!isFlowCv) y -= 3.5;
    }

    for (const bulletText of bullets) {
      const parts = wrap(
        bulletText,
        bulletSize,
        width - margin * 2 - (isFlowCv ? 10 : 22),
      );
      parts.forEach((part, index) => {
        ensure(bulletLeading + bulletGap);
        if (index === 0) {
          page.drawText("•", {
            x: margin + (isFlowCv ? 1 : 5),
            y,
            size: bulletSize,
            font: regular,
            color: ink,
          });
        }
        drawText(part, {
          x: margin + (isFlowCv ? 10 : 17),
          y,
          size: bulletSize,
          font: regular,
          color: ink,
        });
        y -= bulletLeading;
      });
      y -= bulletGap;
    }
    if (hasFollowingEntry) y -= entryGap;
  };
  const drawFlatSkills = (items: string[]) => {
    const size = 9.5;
    const maxX = width - margin;
    const startX = margin;
    let x = startX;
    for (const item of items) {
      const token = `• ${clean(item)}`;
      const tokenWidth = measureText(token, size);
      if (x > startX && x + tokenWidth > maxX) {
        y -= bulletLeading + bulletGap;
        ensure(bulletLeading + bulletGap);
        x = startX;
      }
      drawText(token, { x, y, size, font: regular, color: ink });
      x += tokenWidth + 10;
    }
    y -= bulletLeading;
  };
  const skillsHeight = (items: ResumeSectionItem[]) => {
    const measuredSkillSize = isFlowCv ? 11 : 9.5;
    const measuredHeadingSize = isFlowCv ? 11 : 10;
    const measuredGroupGap = isFlowCv ? 0 : 4;
    const groups = items.map((item) => ({
      heading: item.heading?.replaceAll("**", "").trim() ?? "",
      skills: [item.subheading, item.dateRange, ...(item.bullets ?? []).map(pdfBulletText)]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.replaceAll("**", "").trim())
        .filter(Boolean),
    }));
    const contentWidth = width - margin * 2;
    const grouped = groups.some((group) => Boolean(group.heading));
    if (!grouped) {
      let rows = 1;
      let rowWidth = 0;
      for (const item of groups.flatMap((group) => group.skills)) {
        const tokenWidth = measureText(`• ${clean(item)}`, measuredSkillSize) + 10;
        if (rowWidth && rowWidth + tokenWidth > contentWidth) {
          rows += 1;
          rowWidth = 0;
        }
        rowWidth += tokenWidth;
      }
      return rows * (bulletLeading + bulletGap);
    }
    const layout = design.skillsLayout === "flat-inline"
      ? "grouped-inline"
      : design.skillsLayout;
    const measureStackedGroup = (group: (typeof groups)[number], availableWidth: number) => {
      const headingLines = group.heading
        ? wrap(group.heading, measuredHeadingSize, availableWidth, bold).length
        : 0;
      const body = group.skills.join(", ");
      const bodyLines = body ? wrap(body, measuredSkillSize, availableWidth).length : 0;
      return headingLines * 13.5 + (headingLines && bodyLines ? 4 : 0) + bodyLines * bulletLeading + 10;
    };
    let measured: number;
    if (layout === "grouped-columns" && groups.length > 1) {
      const columnWidth = (contentWidth - 24) / 2;
      const heights = groups.map((group) => measureStackedGroup(group, columnWidth));
      measured = Number.POSITIVE_INFINITY;
      for (let index = 1; index < groups.length; index += 1) {
        measured = Math.min(measured, Math.max(
          heights.slice(0, index).reduce((sum, value) => sum + value, 0),
          heights.slice(index).reduce((sum, value) => sum + value, 0),
        ));
      }
    } else if (layout === "grouped-stacked") {
      measured = groups.reduce(
        (sum, group) => sum + measureStackedGroup(group, contentWidth),
        0,
      );
    } else {
      measured = groups.reduce((sum, group) => {
        const labelWidth = measureText(`${clean(group.heading)}:`, measuredHeadingSize, bold);
        const body = group.skills.join(", ");
        const inline = Boolean(body) && labelWidth <= contentWidth * .45;
        if (inline) {
          const continuationInset = template === "flowcv"
            ? 0
            : Math.min(labelWidth + 6, 120);
          return sum + Math.max(1, wrapWithFirstLineWidth(
            body,
            measuredSkillSize,
            contentWidth - labelWidth - 4,
            contentWidth - continuationInset,
          ).length) * bulletLeading + measuredGroupGap;
        }
        return sum + wrap(group.heading, measuredHeadingSize, contentWidth, bold).length * 13.5
          + (body ? 4 + wrap(body, measuredSkillSize, contentWidth).length * bulletLeading : 0)
          + measuredGroupGap;
      }, 0);
    }
    return Math.min(measured, height - margin * 2 - 60);
  };
  const skills = (items: ResumeSectionItem[]) => {
    const groups = items.map((item) => ({
      heading: item.heading?.replaceAll("**", "").trim() ?? "",
      skills: [
        item.subheading,
        item.dateRange,
        ...(item.bullets ?? []).map(pdfBulletText),
      ].filter((value): value is string => Boolean(value))
        .map((value) => value.replaceAll("**", "").trim())
        .filter(Boolean),
    }));
    const grouped = groups.some((group) => Boolean(group.heading));
    if (!grouped) {
      drawFlatSkills(groups.flatMap((group) => group.skills));
      return;
    }

    const layout = design.skillsLayout === "flat-inline"
      ? "grouped-inline"
      : design.skillsLayout;
    const contentWidth = width - margin * 2;
    const skillSize = isFlowCv ? 11 : 9.5;
    const groupHeadingSize = isFlowCv ? 11 : 10;
    const groupGap = isFlowCv ? 0 : 10;
    const contentGap = isFlowCv ? 0 : 4;

    const groupBody = (group: (typeof groups)[number]) => group.skills.join(", ");
    const groupHeight = (group: (typeof groups)[number], availableWidth: number) => {
      const headingLines = group.heading
        ? wrap(group.heading, groupHeadingSize, availableWidth, bold).length
        : 0;
      const bodyLines = groupBody(group)
        ? wrap(groupBody(group), skillSize, availableWidth).length
        : 0;
      return headingLines * 13.5
        + (headingLines && bodyLines ? contentGap : 0)
        + bodyLines * bulletLeading
        + groupGap;
    };
    const drawStacked = () => {
      groups.forEach((group, groupIndex) => {
        const headingParts = group.heading
          ? wrap(group.heading, groupHeadingSize, contentWidth, bold)
          : [];
        const bodyParts = wrap(groupBody(group), skillSize, contentWidth);
        const needed = headingParts.length * 13.5
          + (headingParts.length && bodyParts.length ? contentGap : 0)
          + bodyParts.length * bulletLeading
          + groupGap;
        ensure(Math.min(needed, height - margin * 2));
        if (group.heading) {
          for (const part of headingParts) {
            ensure(13.5);
            drawText(part, { x: margin, y, size: groupHeadingSize, font: bold, color: ink });
            y -= 13.5;
          }
        }
        if (bodyParts.length && group.heading) y -= contentGap;
        for (const part of bodyParts) {
          ensure(bulletLeading);
          drawText(part, { x: margin, y, size: skillSize, font: regular, color: ink });
          y -= bulletLeading;
        }
        if (groupIndex < groups.length - 1) y -= groupGap;
      });
    };
    const drawInline = () => {
      groups.forEach((group, groupIndex) => {
        const label = group.heading ? `${clean(group.heading)}:` : "";
        const body = groupBody(group);
        const labelWidth = label
          ? measureText(label, groupHeadingSize, bold)
          : 0;
        const labelFitsInline = Boolean(body) && labelWidth <= contentWidth * .45;
        const inlineGap = isFlowCv ? 2.5 : 6;
        const continuationInset = template === "flowcv"
          ? 0
          : Math.min(labelWidth + 6, 120);
        const parts = labelFitsInline
          ? wrapWithFirstLineWidth(
            body,
            skillSize,
            contentWidth - labelWidth - inlineGap,
            contentWidth - continuationInset,
          )
          : wrap(body, skillSize, contentWidth);
        const needed = (
          labelFitsInline
            ? parts.length * bulletLeading
            : (label ? 13.5 + (body ? contentGap : 0) : 0) + parts.length * bulletLeading
        ) + (groupIndex < groups.length - 1 && !isFlowCv ? 4 : 0);
        ensure(Math.min(needed, height - margin * 2));
        if (!labelFitsInline) {
          if (label) {
            ensure(13.5);
            drawText(label, { x: margin, y, size: groupHeadingSize, font: bold, color: ink });
            y -= 13.5 + (body ? contentGap : 0);
          }
          for (const part of parts) {
            ensure(bulletLeading);
            drawText(part, { x: margin, y, size: skillSize, font: regular, color: ink });
            y -= bulletLeading;
          }
        } else {
          ensure(bulletLeading);
          drawText(label, { x: margin, y, size: groupHeadingSize, font: bold, color: ink });
          parts.forEach((part, index) => {
            if (index > 0) ensure(bulletLeading);
            drawText(part, {
              x: margin + (index === 0 ? labelWidth + inlineGap : continuationInset),
              y,
              size: skillSize,
              font: regular,
              color: ink,
            });
            y -= bulletLeading;
          });
        }
        if (groupIndex < groups.length - 1 && !isFlowCv) y -= 4;
      });
    };
    const drawColumns = () => {
      if (groups.length < 2) {
        drawStacked();
        return;
      }
      const gutter = 24;
      const columnWidth = (contentWidth - gutter) / 2;
      const heights = groups.map((group) => groupHeight(group, columnWidth));
      let splitIndex = 1;
      let bestDifference = Number.POSITIVE_INFINITY;
      for (let index = 1; index < groups.length; index += 1) {
        const leftHeight = heights.slice(0, index).reduce((sum, value) => sum + value, 0);
        const rightHeight = heights.slice(index).reduce((sum, value) => sum + value, 0);
        const difference = Math.abs(leftHeight - rightHeight);
        if (difference < bestDifference) {
          bestDifference = difference;
          splitIndex = index;
        }
      }
      const columns = [groups.slice(0, splitIndex), groups.slice(splitIndex)];
      const columnHeights = [
        heights.slice(0, splitIndex).reduce((sum, value) => sum + value, 0),
        heights.slice(splitIndex).reduce((sum, value) => sum + value, 0),
      ];
      const totalHeight = Math.max(...columnHeights);
      if (totalHeight > y - margin || columnWidth < 210) {
        drawStacked();
        return;
      }
      const startY = y;
      let lowestY = y;
      columns.forEach((column, columnIndex) => {
        const x = margin + columnIndex * (columnWidth + gutter);
        let columnY = startY;
        column.forEach((group) => {
          if (group.heading) {
            for (const part of wrap(group.heading, groupHeadingSize, columnWidth, bold)) {
              drawText(part, { x, y: columnY, size: groupHeadingSize, font: bold, color: ink });
              columnY -= 13.5;
            }
          }
          const body = groupBody(group);
          if (body) {
            if (group.heading) columnY -= contentGap;
            for (const part of wrap(body, skillSize, columnWidth)) {
              drawText(part, { x, y: columnY, size: skillSize, font: regular, color: ink });
              columnY -= bulletLeading;
            }
          }
          columnY -= groupGap;
        });
        lowestY = Math.min(lowestY, columnY);
      });
      y = lowestY + groupGap;
    };

    if (layout === "grouped-columns") drawColumns();
    else if (layout === "grouped-stacked") drawStacked();
    else drawInline();
  };
  return {
    header,
    line,
    heading,
    paragraph,
    section,
    skillsHeight,
    skills,
    entry,
    centeredLine,
    space(amount) {
      y -= amount;
    },
    async save() {
      return new Uint8Array(await document.save());
    },
  };
}
