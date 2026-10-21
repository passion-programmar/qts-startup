import type {
  CoverLetterDocument,
  PdfPackage,
  ResumeDocument,
} from "@/app/pdf/document-data";
import {
  pdfTemplateDesigns,
  type PdfTemplate,
} from "@/server/pdf/pdf-templates";

type PdfWriter = {
  header(title: string, detail: string, size?: number): void;
  line(text: string, size?: number, color?: "black" | "gray"): void;
  heading(text: string, size?: number): void;
  paragraph(text: string, size?: number): void;
  section(text: string): void;
  bullet(text: string): void;
  inlineBullets(items: string[]): void;
  entry(heading: string, dateRange?: string, subheading?: string): void;
  centeredLine(text: string, size?: number): void;
  space(amount: number): void;
  save(): Promise<Uint8Array>;
};

export async function renderPdfPackage(
  data: PdfPackage,
  template: PdfTemplate,
): Promise<{ resume: Uint8Array; coverLetter: Uint8Array }> {
  const [resume, coverLetter] = await Promise.all([
    renderResumePdf(data.resume, template),
    renderCoverLetterPdf(data.coverLetter, template),
  ]);
  return { resume, coverLetter };
}

async function renderResumePdf(
  document: ResumeDocument,
  template: PdfTemplate,
): Promise<Uint8Array> {
  const pdf = await createWriter(template, 2);
  const headline = document.candidate.headline ?? document.targetRole;
  const contact = [
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
    document.candidate.location,
  ].filter(Boolean).join("  |  ");
  pdf.header(document.candidate.fullName, [
    ...(template === "vellum" ? [headline] : [headline, contact]),
  ].filter(Boolean).join(" | "), 19);
  if (template === "vellum" && contact) pdf.centeredLine(contact, 8.5);
  if (document.summary) {
    pdf.section(template === "vellum" ? "Summary" : "Professional Summary");
    pdf.paragraph(document.summary);
  }
  for (const section of document.sections) {
    pdf.section(section.title);
    const inlineItems = template === "vellum"
      && /^(skills|technical skills|core skills|languages)$/i.test(section.title);
    if (inlineItems) {
      pdf.inlineBullets(section.items.flatMap((item) => [
        item.heading,
        item.subheading,
        item.dateRange,
        ...(item.bullets ?? []),
      ].filter((value): value is string => Boolean(value))
        .map((item) => item.replaceAll("**", ""))));
      continue;
    }
    for (const item of section.items) {
      if (item.heading) {
        if (template === "vellum") {
          pdf.entry(item.heading, item.dateRange, item.subheading);
        } else {
          pdf.heading(
            `${item.heading}${item.dateRange ? `  |  ${item.dateRange}` : ""}`,
            11,
          );
          if (item.subheading) pdf.line(item.subheading, 9, "gray");
        }
      } else if (template === "vellum" && (item.dateRange || item.subheading)) {
        pdf.entry("", item.dateRange, item.subheading);
      } else if (item.subheading) {
        pdf.line(item.subheading, 9, "gray");
      }
      for (const bullet of item.bullets ?? []) {
        pdf.bullet(bullet.replaceAll("**", ""));
      }
    }
  }
  return pdf.save();
}

async function renderCoverLetterPdf(
  document: CoverLetterDocument,
  template: PdfTemplate,
): Promise<Uint8Array> {
  const pdf = await createWriter(template, 1);
  pdf.header(document.candidate.fullName, [
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
  ].filter(Boolean).join(" | "), 17);
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
  template: PdfTemplate,
  maxPages: number,
): Promise<PdfWriter> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const design = pdfTemplateDesigns[template];
  const fontNames = design.font === "serif"
    ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold]
    : design.font === "mono"
      ? [StandardFonts.Courier, StandardFonts.CourierBold]
      : [StandardFonts.Helvetica, StandardFonts.HelveticaBold];
  const regular = await document.embedFont(fontNames[0]);
  const bold = await document.embedFont(fontNames[1]);
  const width = 595.28;
  const height = 841.89;
  const accent = rgb(...design.accent);
  const ink = rgb(...design.ink);
  const muted = rgb(...design.muted);
  const margin = design.margin;
  const sectionGap = design.compact ? 4 : 9;
  const lineGap = design.compact ? 2 : 4;
  let page = document.addPage([width, height]);
  let y = height - margin;
  const clean = (text: string) => text.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2022]/g, "?");
  const ensure = (needed = 18) => {
    if (y < margin + needed) {
      if (document.getPageCount() >= maxPages) {
        throw new Error(maxPages === 1
          ? "The cover letter exceeds one A4 page. Shorten its paragraphs."
          : "The résumé exceeds two A4 pages. Shorten its content.");
      }
      page = document.addPage([width, height]);
      y = height - margin;
    }
  };
  const wrap = (text: string, size: number, maxWidth: number) => {
    const words = clean(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(next, size) <= maxWidth || !line) {
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
      const textWidth = regular.widthOfTextAtSize(part, size);
      page.drawText(part, {
        x: centered ? Math.max(margin, (width - textWidth) / 2) : margin + inset,
        y,
        size,
        font: regular,
        color: color === "gray" ? muted : ink,
      });
      y -= size + lineGap;
    }
  };
  const line = (text: string, size = 10, color: "black" | "gray" = "black") => {
    drawWrapped(text, size, color, false);
  };
  const heading = (text: string, size = 12) => {
    ensure(size + 7);
    const cleaned = clean(text);
    const textWidth = bold.widthOfTextAtSize(cleaned, size);
    page.drawText(clean(text), {
      x: design.align === "center" ? Math.max(margin, (width - textWidth) / 2) : margin,
      y,
      size,
      font: bold,
      color: accent,
      maxWidth: width - margin * 2,
    });
    y -= size + 6;
  };
  const centeredLine = (text: string, size = 10) => {
    drawWrapped(text, size, "gray", true);
  };
  const header = (title: string, detail: string, size = 19) => {
    if (template === "vellum") {
      ensure(size + 42);
      page.drawLine({
        start: { x: margin, y: y + 10 },
        end: { x: width - margin, y: y + 10 },
        thickness: 0.55,
        color: muted,
      });
      const titleWidth = bold.widthOfTextAtSize(clean(title), size);
      page.drawText(clean(title), {
        x: Math.max(margin, (width - titleWidth) / 2),
        y,
        size,
        font: bold,
        color: ink,
        maxWidth: width - margin * 2,
      });
      y -= size + 4;
      if (detail) {
        for (const part of wrap(detail, 10, width - margin * 2)) {
          ensure(15);
          const textWidth = regular.widthOfTextAtSize(part, 10);
          page.drawText(part, {
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
    const headerFill = template === "orchid"
      ? rgb(.38, .08, .28)
      : template === "amber-crest"
        ? rgb(.07, .12, .22)
        : template === "terminal"
          ? rgb(.08, .11, .14)
          : template === "onyx"
            ? rgb(.12, .13, .15)
            : template === "basalt"
              ? rgb(.15, .18, .23)
              : template === "sentinel"
                ? rgb(.03, .13, .28)
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
    const titleWidth = bold.widthOfTextAtSize(cleanedTitle, size);
    const centered = design.align === "center";
    page.drawText(cleanedTitle, {
      x: centered ? Math.max(margin, (width - titleWidth) / 2) : margin,
      y,
      size,
      font: bold,
      color: darkHeader && !["onyx", "amber-crest", "terminal"].includes(template)
        ? rgb(1, 1, 1)
        : accent,
      maxWidth: width - margin * 2,
    });
    y -= size + 7;
    for (const part of wrap(detail, 9, width - margin * 2)) {
      const detailWidth = regular.widthOfTextAtSize(part, 9);
      page.drawText(part, {
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
  };
  const paragraph = (text: string, size = 10) => line(text, size);
  const section = (text: string) => {
    y -= sectionGap;
    ensure(28);
    const label = clean(template === "vellum" ? text : text.toUpperCase());
    const labelSize = 10.5;
    const labelWidth = bold.widthOfTextAtSize(label, labelSize);
    if (template === "vellum") {
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
      page.drawText(label, {
        x: labelLeft,
        y,
        size: labelSize,
        font: bold,
        color: ink,
      });
      y -= 18;
      return;
    }
    if (design.section === "band" || design.section === "card") {
      page.drawRectangle({ x: margin, y: y - 4, width: width - margin * 2, height: 18, color: design.section === "card" ? rgb(.94, .95, .97) : accent });
    } else if (design.section === "pill") {
      page.drawRectangle({ x: margin, y: y - 4, width: labelWidth + 22, height: 18, color: rgb(.91, .94, .97) });
    } else if (design.section === "marker") {
      page.drawRectangle({ x: margin, y: y - 2, width: 5, height: 14, color: accent });
    }
    page.drawText(label, {
      x: margin + (design.section === "marker" ? 12 : design.section === "pill" ? 10 : 0),
      y,
      size: labelSize,
      font: bold,
      color: design.section === "band" ? rgb(1, 1, 1) : accent,
    });
    y -= 15;
    if (design.section === "rule" || design.section === "double-rule") {
      page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: 1, color: accent });
      if (design.section === "double-rule") page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .4, color: accent });
      y -= design.section === "double-rule" ? 5 : 3;
    }
  };
  const entry = (title: string, dateRange?: string, subheading?: string) => {
    const titleSize = 10.5;
    const dateSize = 9;
    const cleanedTitle = clean(title);
    const cleanedDate = dateRange ? clean(dateRange) : "";
    const dateWidth = cleanedDate ? regular.widthOfTextAtSize(cleanedDate, dateSize) : 0;
    const availableTitleWidth = width - margin * 2 - dateWidth - (cleanedDate ? 10 : 0);
    const titleLines = wrap(cleanedTitle, titleSize, availableTitleWidth);
    titleLines.forEach((part, index) => {
      ensure(titleSize + lineGap + 3);
      page.drawText(part, {
        x: margin,
        y,
        size: titleSize,
        font: bold,
        color: ink,
        maxWidth: index === 0 ? availableTitleWidth : width - margin * 2,
      });
      if (index === 0 && cleanedDate) {
        page.drawText(cleanedDate, {
          x: width - margin - dateWidth,
          y,
          size: dateSize,
          font: regular,
          color: muted,
          maxWidth: dateWidth,
        });
      }
      y -= titleSize + lineGap;
    });
    if (subheading) drawWrapped(subheading, 9, "gray");
    y -= 2;
  };
  const inlineBullets = (items: string[]) => {
    const text = items.map((item) => `• ${item}`).join("    ");
    drawWrapped(text, 9.5);
  };
  const bullet = (text: string) => {
    const parts = wrap(text, 9.5, width - margin * 2 - 15);
    parts.forEach((part, index) => {
      ensure(14);
      page.drawText(index === 0 ? `• ${part}` : `  ${part}`, {
        x: margin + 6,
        y,
        size: 9.5,
        font: regular,
        color: ink,
      });
      y -= 13;
    });
  };
  return {
    header,
    line,
    heading,
    paragraph,
    section,
    bullet,
    inlineBullets,
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
