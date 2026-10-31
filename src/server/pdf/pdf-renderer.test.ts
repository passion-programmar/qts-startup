import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import type { PdfPackage } from "@/app/pdf/document-data";
import { DocumentPageLimitError } from "@/app/pdf/document-page-limit-error";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import {
  isPdfTemplate,
  pdfTemplateDesigns,
  pdfTemplateLabels,
  pdfTemplateValues,
} from "@/server/pdf/pdf-templates";

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
  assert.equal(pdfTemplateValues.length, 24);
  for (const template of pdfTemplateValues) {
    const rendered = await renderPdfPackage(data, template);
    assert.equal(Buffer.from(rendered.resume).subarray(0, 4).toString(), "%PDF", template);
    assert.equal(Buffer.from(rendered.coverLetter).subarray(0, 4).toString(), "%PDF", template);
    const resume = await PDFDocument.load(rendered.resume);
    const coverLetter = await PDFDocument.load(rendered.coverLetter);
    assert.ok(resume.getPageCount() >= 1 && resume.getPageCount() <= 3, template);
    assert.equal(coverLetter.getPageCount(), 1, template);
  }
});

test("templates are numbered QTS Template 1 to 24 in rotation order and exclude retired IDs", () => {
  assert.deepEqual(
    pdfTemplateValues.map((template) => pdfTemplateLabels[template]),
    Array.from({ length: 24 }, (_, index) => `QTS Template ${index + 1}`),
  );
  assert.equal(isPdfTemplate("qts-standard"), true);
  assert.equal(isPdfTemplate("flowcv"), false);
  assert.equal(isPdfTemplate("orchid"), false);
});

test("full resume sections and bullets fit without exceeding three pages", async () => {
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
          title: "Core Technical Skills",
          items: [
            { heading: "Experimentation & Analytics", bullets: ["A/B Testing", "Causal Inference", "Hypothesis Testing", "Statistical Validation"] },
            { heading: "Programming & Data Stack", bullets: ["Python", "pandas", "NumPy", "SQL", "FastAPI", "REST APIs", "Data Processing"] },
            { heading: "LLM & GenAI", bullets: ["LLMs", "Prompt Engineering", "RAG Workflows", "Embeddings", "NLP", "Model Integration"] },
            { heading: "Data Engineering Collaboration", bullets: ["Pipeline Validation", "PostgreSQL", "Data Quality Checks", "ETL Collaboration"] },
            { heading: "Delivery & Communication", bullets: ["Technical Communication", "Cross-functional Collaboration", "Documentation"] },
          ],
        },
      ],
    },
  };

  for (const template of pdfTemplateValues) {
    const rendered = await renderPdfPackage(fullResume, template);
    const resume = await PDFDocument.load(rendered.resume);
    assert.ok(resume.getPageCount() >= 1 && resume.getPageCount() <= 3, template);
  }
});

test("template matrix assigns varied section and skills layouts", () => {
  const sectionLayouts = new Set(pdfTemplateValues.map(
    (template) => pdfTemplateDesigns[template].sectionHeadingLayout,
  ));
  const skillsLayouts = new Set(pdfTemplateValues.map(
    (template) => pdfTemplateDesigns[template].skillsLayout,
  ));
  assert.ok(sectionLayouts.has("left-full-rule"));
  assert.ok(sectionLayouts.has("compact-underline"));
  assert.ok(sectionLayouts.has("centered-rules"));
  assert.deepEqual(
    [...skillsLayouts].sort(),
    // The column layout (titles on top, skills listed under them) is no longer used.
    ["flat-inline", "grouped-inline", "grouped-stacked"],
  );
});

test("flat skills render through the safe inline fallback", async () => {
  const flatSkills: PdfPackage = {
    ...data,
    resume: {
      ...data.resume,
      sections: [{
        title: "Core Technical Skills",
        items: [{ bullets: ["Python", "SQL", "Machine Learning", "REST APIs"] }],
      }],
    },
  };
  const rendered = await renderPdfPackage(flatSkills, "minimal");
  const resume = await PDFDocument.load(rendered.resume);
  assert.equal(resume.getPageCount(), 1);
});

test("all templates render Romanian characters in both documents", async () => {
  const unicodePackage: PdfPackage = {
    ...data,
    resume: {
      ...data.resume,
      candidate: {
        ...data.resume.candidate,
        fullName: "Ștefan Popescu",
        location: "Brașov, Iași, România",
      },
      summary: "ă â î ș ț Ă Â Î Ș Ț",
      sections: [{
        title: "Education",
        items: [{
          heading: "Bachelor’s Degree in Computer Science",
          subheading: "Babeș-Bolyai University · Brașov, România",
          dateRange: "2011 – 2015",
          bullets: ["ă", "ă â î ș ț Ă Â Î Ș Ț"],
        }],
      }],
    },
    coverLetter: {
      ...data.coverLetter,
      bodyParagraphs: ["Brașov, România: ă â î ș ț Ă Â Î Ș Ț."],
    },
  };
  for (const template of pdfTemplateValues) {
    const rendered = await renderPdfPackage(unicodePackage, template);
    const resume = await PDFDocument.load(rendered.resume);
    const coverLetter = await PDFDocument.load(rendered.coverLetter);
    assert.ok(resume.getPageCount() >= 1 && resume.getPageCount() <= 3, template);
    assert.equal(coverLetter.getPageCount(), 1, template);
  }
});

test("the fallback rejects a résumé that exceeds three pages without truncation", async () => {
  const overlong: PdfPackage = {
    ...data,
    resume: {
      ...data.resume,
      summary: "Long document content. ".repeat(5000),
      sections: [],
    },
  };
  await assert.rejects(
    renderPdfPackage(overlong, "minimal"),
    (error: unknown) => error instanceof DocumentPageLimitError
      && /3 A4 pages/.test(error.message)
      && /not truncated/.test(error.message),
  );
});
