import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import type { PdfPackage } from "@/app/pdf/document-data";
import { DocumentPageLimitError } from "@/app/pdf/document-page-limit-error";
import { contactSeparator, fitContactLine, renderPdfPackage } from "@/app/pdf/pdf-renderer";
import {
  isPdfTemplate,
  pdfTemplateDesigns,
  pdfTemplateLabels,
  pdfTemplateSupportedValues,
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

test("every supported template renders a valid resume and cover letter PDF", async () => {
  assert.equal(pdfTemplateValues.length, 13);
  assert.equal(pdfTemplateSupportedValues.length, 24);
  for (const template of pdfTemplateSupportedValues) {
    const rendered = await renderPdfPackage(data, template);
    assert.equal(Buffer.from(rendered.resume).subarray(0, 4).toString(), "%PDF", template);
    assert.equal(Buffer.from(rendered.coverLetter).subarray(0, 4).toString(), "%PDF", template);
    const resume = await PDFDocument.load(rendered.resume);
    const coverLetter = await PDFDocument.load(rendered.coverLetter);
    assert.ok(resume.getPageCount() >= 1 && resume.getPageCount() <= 3, template);
    assert.equal(coverLetter.getPageCount(), 1, template);
  }
});

test("active templates are renumbered in rotation order and hidden templates remain supported", () => {
  assert.deepEqual(
    [...pdfTemplateValues],
    [
      "startup", "minimal", "classic", "centered", "corporate", "creative",
      "nordic", "ledger", "banded", "executive", "academic", "graphite", "qts-standard",
    ],
  );
  assert.deepEqual(
    pdfTemplateValues.map((template) => pdfTemplateLabels[template]),
    Array.from({ length: 13 }, (_, index) => `QTS Template ${index + 1}`),
  );
  assert.equal(isPdfTemplate("bold"), true);
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

test("the fallback rejects a résumé that exceeds five pages without truncation", async () => {
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
      && /5 A4 pages/.test(error.message)
      && /not truncated/.test(error.message),
  );
});

test("the contact line fits on one line, growing into the margin before shrinking, never below 8pt", () => {
  const pageWidth = 595.28;
  const margin = 48;
  const mm = 72 / 25.4;
  // A line whose width is proportional to its size, like a run of text in one font.
  const line = (widthAtNinePoints: number) => (size: number) => widthAtNinePoints * size / 9;
  const inside = pageWidth - margin * 2;

  assert.deepEqual(
    fitContactLine(line(inside - 10), { pageWidth, margin, size: 9, centered: false }),
    { size: 9, left: margin, right: margin, fits: true },
  );

  // Slightly too wide: same size, the right end runs into the margin; the left stays aligned.
  const widened = fitContactLine(line(inside + 10), { pageWidth, margin, size: 9, centered: false });
  assert.equal(widened.size, 9);
  assert.equal(widened.left, margin);
  assert.ok(Math.abs(widened.right - 8 * mm) < 0.01);

  // A centred line grows on both sides.
  const centred = fitContactLine(line(inside + 30), { pageWidth, margin, size: 9, centered: true });
  assert.equal(centred.size, 9);
  assert.ok(Math.abs(centred.left - 8 * mm) < 0.01 && Math.abs(centred.right - 8 * mm) < 0.01);

  // Wider still: it shrinks by quarter points and stops at the first size that fits.
  const shrunk = fitContactLine(line((pageWidth - margin - 8 * mm) * 9 / 8.5), { pageWidth, margin, size: 9, centered: false });
  assert.equal(shrunk.size, 8.5);
  assert.ok(shrunk.fits);

  // Too wide even at 8pt with 8 mm: it may use the margin up to 6 mm, right end first.
  const lastRight = fitContactLine(line((pageWidth - margin - 6 * mm) * 9 / 8), { pageWidth, margin, size: 9, centered: false });
  assert.equal(lastRight.size, 8);
  assert.equal(lastRight.left, margin);
  assert.ok(lastRight.fits);
  const lastBoth = fitContactLine(line((pageWidth - 12 * mm) * 9 / 8), { pageWidth, margin, size: 9, centered: false });
  assert.equal(lastBoth.size, 8);
  assert.ok(Math.abs(lastBoth.left - 6 * mm) < 0.01);
  assert.ok(lastBoth.fits);

  // Longer than the page allows: still one line at 8pt, reported as not fitting.
  const tooLong = fitContactLine(line(pageWidth * 2), { pageWidth, margin, size: 9, centered: false });
  assert.equal(tooLong.size, 8);
  assert.equal(tooLong.fits, false);

  // A header box that stops inside the margin keeps the line inside it.
  const boxed = fitContactLine(line(inside + 10), { pageWidth, margin, size: 9, centered: false, innerEdge: margin - 6 });
  assert.ok(boxed.right >= margin - 6);
});

test("centred-header templates separate contact items with bullets; the others use a bar", () => {
  for (const template of ["startup", "centered", "nordic", "banded", "academic"] as const) {
    assert.equal(contactSeparator(template), "•", template);
  }
  for (const template of ["minimal", "classic", "corporate", "creative", "ledger", "executive", "graphite", "qts-standard"] as const) {
    assert.equal(contactSeparator(template), "|", template);
  }
});

test("every template renders a very long contact line", async () => {
  const long: PdfPackage = {
    ...data,
    resume: {
      ...data.resume,
      candidate: {
        ...data.resume.candidate,
        email: "maximilian.alexander.konstantinopoulos.engineering@protonmail.com",
        phone: "+44 (0) 7700 900 123 ext 45",
        location: "Newcastle upon Tyne, Tyne and Wear, United Kingdom",
        linkedinUrl: "https://www.linkedin.com/in/maximilian-alexander-konstantinopoulos-senior-engineer",
      },
    },
    coverLetter: {
      ...data.coverLetter,
      candidate: {
        ...data.coverLetter.candidate,
        email: "maximilian.alexander.konstantinopoulos.engineering@protonmail.com",
        phone: "+44 (0) 7700 900 123 ext 45",
        linkedinUrl: "https://www.linkedin.com/in/maximilian-alexander-konstantinopoulos-senior-engineer",
      },
    },
  };
  for (const template of pdfTemplateSupportedValues) {
    const rendered = await renderPdfPackage(long, template);
    assert.equal((await PDFDocument.load(rendered.resume)).getPageCount() >= 1, true, template);
    assert.equal((await PDFDocument.load(rendered.coverLetter)).getPageCount(), 1, template);
  }
});
