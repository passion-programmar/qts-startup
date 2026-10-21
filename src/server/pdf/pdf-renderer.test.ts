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

test("full resume sections and bullets fit without exceeding two pages", async () => {
  const fullResume: PdfPackage = {
    ...data,
    resume: {
      ...data.resume,
      summary: "Software engineer building dependable web products, improving service performance, and collaborating across teams to deliver practical customer outcomes.",
      sections: [
        {
          title: "Experience",
          items: [
            {
              heading: "Senior Software Engineer",
              subheading: "Northstar Digital · Austin, TX",
              dateRange: "2021 – Present",
              bullets: [
                "Designed Node.js services supporting customer workflows and improved peak-load reliability through performance tuning.",
                "Reduced API response times by optimizing database access patterns and adding query monitoring.",
                "Built reusable React and TypeScript components with product and design partners.",
                "Introduced automated integration checks into the delivery pipeline.",
                "Mentored engineers through design reviews, pairing, and practical documentation.",
              ],
            },
            {
              heading: "Software Engineer",
              subheading: "Cedar Labs · Dallas, TX",
              dateRange: "2018 – 2021",
              bullets: [
                "Delivered customer-facing features using React, Express, and PostgreSQL.",
                "Integrated external payment and identity services with robust error handling.",
                "Expanded automated test coverage using Jest and Cypress.",
                "Worked with support and analytics teams to prioritize durable fixes.",
                "Migrated legacy interface modules to accessible, maintainable components.",
              ],
            },
          ],
        },
        {
          title: "Education",
          items: [{
            heading: "Bachelor of Science in Computer Science",
            subheading: "Hillview State University · Austin, TX",
            dateRange: "2014 – 2018",
            bullets: ["Focus: Software systems and applied mathematics", "Graduated with honors"],
          }],
        },
        {
          title: "Skills",
          items: [{
            bullets: [
              "JavaScript", "TypeScript", "React", "Node.js", "Express",
              "REST APIs", "PostgreSQL", "MongoDB", "Jest", "Cypress",
              "Git", "CI/CD", "AWS", "Docker", "Agile delivery",
            ],
          }],
        },
      ],
    },
  };

  for (const template of pdfTemplateValues) {
    const rendered = await renderPdfPackage(fullResume, template);
    const resume = await PDFDocument.load(rendered.resume);
    assert.ok(resume.getPageCount() >= 1 && resume.getPageCount() <= 2, template);
  }
});
