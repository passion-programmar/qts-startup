import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import type { PdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import { pdfTemplateLabels, pdfTemplateValues } from "@/server/pdf/pdf-templates";

const data: PdfPackage = {
  resume: {
    candidate: {
      fullName: "Jordan Taylor",
      email: "jordan@example.com",
      phone: "+1 555 0100",
      headline: "Program Coordinator",
      location: "Austin, TX",
    },
    targetRole: "Program Coordinator",
    targetCompany: "Example Company",
    summary: "Program coordinator experienced in delivery tracking and stakeholder communication.",
    sections: [{
      title: "Professional Experience",
      items: [{
        heading: "Program Coordinator",
        subheading: "Example Organization",
        dateRange: "2022 - Present",
        bullets: ["Coordinated schedules, records, and deliverables across multiple programs."],
      }],
    }],
  },
  coverLetter: {
    candidate: { fullName: "Jordan Taylor", email: "jordan@example.com" },
    targetRole: "Program Coordinator",
    targetCompany: "Example Company",
    salutation: "Dear Hiring Manager,",
    bodyParagraphs: ["I am applying for the Program Coordinator position."],
    closing: "Sincerely,",
    signatureName: "Jordan Taylor",
  },
};

test("every one-column template renders a valid resume and cover letter PDF", async () => {
  assert.equal(pdfTemplateValues.length, 30);
  for (const template of pdfTemplateValues) {
    const rendered = await renderPdfPackage(data, template);
    assert.equal(Buffer.from(rendered.resume).subarray(0, 4).toString(), "%PDF", template);
    assert.equal(Buffer.from(rendered.coverLetter).subarray(0, 4).toString(), "%PDF", template);
    const resume = await PDFDocument.load(rendered.resume);
    const coverLetter = await PDFDocument.load(rendered.coverLetter);
    assert.ok(resume.getPageCount() >= 1 && resume.getPageCount() <= 2, template);
    assert.equal(coverLetter.getPageCount(), 1, template);
  }
});

test("Vellum is named QTS_Template_1 in the template selector", () => {
  assert.equal(pdfTemplateLabels.vellum, "QTS_Template_1");
});
