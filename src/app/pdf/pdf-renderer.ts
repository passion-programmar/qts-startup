import type {
  CoverLetterDocument,
  PdfPackage,
  ResumeDocument,
} from "@/app/pdf/document-data";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";

type PdfWriter = {
  line(text: string, size?: number, color?: "black" | "gray"): void;
  heading(text: string, size?: number): void;
  paragraph(text: string, size?: number): void;
  section(text: string): void;
  bullet(text: string): void;
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
  pdf.heading(document.candidate.fullName, 19);
  pdf.line([
    document.candidate.headline ?? document.targetRole,
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
    document.candidate.location,
  ].filter(Boolean).join(" | "), 9, "gray");
  if (document.summary) {
    pdf.section("Professional Summary");
    pdf.paragraph(document.summary);
  }
  for (const section of document.sections) {
    pdf.section(section.title);
    for (const item of section.items) {
      if (item.heading) {
        pdf.heading(
          `${item.heading}${item.dateRange ? `  |  ${item.dateRange}` : ""}`,
          11,
        );
      }
      if (item.subheading) pdf.line(item.subheading, 9, "gray");
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
  pdf.heading(document.candidate.fullName, 17);
  pdf.line([
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
  ].filter(Boolean).join(" | "), 9, "gray");
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
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const style = template === "modern"
    ? { margin: 48, heading: rgb(.04, .36, .55), text: rgb(.08, .12, .18), sectionGap: 10, lineGap: 4 }
    : template === "compact"
      ? { margin: 42, heading: rgb(.12, .15, .2), text: rgb(.08, .1, .13), sectionGap: 4, lineGap: 2 }
      : { margin: 54, heading: rgb(.05, .09, .18), text: rgb(.08, .1, .13), sectionGap: 8, lineGap: 4 };
  const margin = style.margin;
  let page = document.addPage([width, height]);
  let y = height - margin;
  const clean = (text: string) => text.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
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
  const line = (
    text: string,
    size = 10,
    color: "black" | "gray" = "black",
  ) => {
    for (const part of wrap(text, size, width - margin * 2)) {
      ensure(size + 5);
      page.drawText(part, {
        x: margin,
        y,
        size,
        font: regular,
        color: color === "gray" ? rgb(.35, .39, .44) : style.text,
      });
      y -= size + style.lineGap;
    }
  };
  const heading = (text: string, size = 12) => {
    ensure(size + 7);
    page.drawText(clean(text), {
      x: margin,
      y,
      size,
      font: bold,
      color: style.heading,
      maxWidth: width - margin * 2,
    });
    y -= size + 6;
  };
  const paragraph = (text: string, size = 10) => line(text, size);
  const section = (text: string) => {
    y -= style.sectionGap;
    ensure(24);
    heading(text.toUpperCase(), 11);
    page.drawLine({
      start: { x: margin, y: y + 3 },
      end: { x: width - margin, y: y + 3 },
      thickness: template === "modern" ? 1.5 : .7,
      color: template === "modern" ? style.heading : rgb(.75, .79, .84),
    });
    y -= 5;
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
        color: rgb(.12, .15, .2),
      });
      y -= 13;
    });
  };
  return {
    line,
    heading,
    paragraph,
    section,
    bullet,
    space(amount) {
      y -= amount;
    },
    async save() {
      return new Uint8Array(await document.save());
    },
  };
}
