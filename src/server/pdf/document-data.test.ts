import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import { templateSectionOrders } from "@/app/pdf/resume-sections";
import sampleFull from "@/app/pdf/sample-full.json";
import { pdfTemplateValues } from "@/server/pdf/pdf-templates";

const validPackage = {
  resume: {
    candidate: { fullName: "Test Candidate", email: "test@example.com" },
    targetRole: "Engineer",
    sections: [{ title: "Experience", items: [{ heading: "Engineer", bullets: ["Built systems"] }] }],
  },
  coverLetter: {
    candidate: { fullName: "Test Candidate", email: "test@example.com" },
    targetRole: "Engineer",
    targetCompany: "Example",
    bodyParagraphs: ["I am applying for this role."],
  },
};

const generatedPackage = {
  ...validPackage,
  resume: {
    ...validPackage.resume,
    summary: "Engineer with five years of experience.",
    sections: [
      { id: "experience", title: "Professional Experience", items: [{ heading: "Engineer", bullets: ["Built systems"] }] },
      { id: "skills", title: "Skills", items: [{ heading: "Cloud", bullets: ["AWS"] }] },
      { id: "education", title: "Education", items: [{ heading: "BSc" }] },
      { id: "projects", title: "Projects", items: [] },
      { id: "career_highlights", title: "Career Highlights", items: [{ bullets: ["Cut costs by 20%."] }] },
      { title: "Languages", items: [{ bullets: ["English"] }] },
      { title: "Volunteer Experience", items: [{ heading: "Helper" }] },
    ],
  },
};

test("PDF document data accepts one resume and cover-letter JSON object", () => {
  const parsed = parsePdfPackage(JSON.stringify(validPackage));
  assert.equal(parsed.resume.targetRole, "Engineer");
  assert.equal(parsed.resume.sections[0].id, "experience");
  assert.equal(parsed.coverLetter.targetCompany, "Example");
});

test("sections get their fixed ids; languages, volunteering and empty sections are dropped", () => {
  const parsed = parsePdfPackage(JSON.stringify(generatedPackage), { requireCoreSections: true });
  assert.deepEqual(
    parsed.resume.sections.map((section) => section.id),
    ["experience", "skills", "education", "career_highlights"],
  );
  assert.equal(parsed.resume.sections[1].type, "skills");
  assert.equal(parsed.resume.sections[3].type, "standard");
});

test("generated JSON must have the summary and the skills, experience and education sections", () => {
  const withoutEducation = {
    ...generatedPackage,
    resume: {
      ...generatedPackage.resume,
      sections: generatedPackage.resume.sections.filter((section) => section.id !== "education"),
    },
  };
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withoutEducation), { requireCoreSections: true }),
    /must include education/,
  );
  const withoutSummary = { ...generatedPackage, resume: { ...generatedPackage.resume, summary: "" } };
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withoutSummary), { requireCoreSections: true }),
    /resume.summary is required/,
  );
  // Stored packages still print without the generation-time requirement.
  assert.doesNotThrow(() => parsePdfPackage(JSON.stringify(withoutEducation)));
});

test("each template shows its own sections in its own order, with its own layout", () => {
  const parsed = parsePdfPackage(JSON.stringify(generatedPackage));
  const technical = toResumeTemplateData(parsed, "technical");
  // Technical shows Projects (empty here, so hidden) and never Career Highlights.
  assert.deepEqual(
    technical.resume.sections.map((section) => section.id),
    ["skills", "experience", "education"],
  );
  assert.deepEqual(technical.theme.sectionOrder, ["summary", "skills", "experience", "education"]);
  const executive = toResumeTemplateData(parsed, "executive");
  assert.deepEqual(
    executive.resume.sections.map((section) => section.id),
    ["career_highlights", "experience", "skills", "education"],
  );
  // Layout options are no longer forced; the template's own design applies.
  assert.equal("skillsLayout" in executive.theme, false);
  assert.equal("bulletStyle" in executive.theme, false);
});

test("every template has a distinct order with the core sections and one of projects or highlights", () => {
  const orders = pdfTemplateValues.map((template) => templateSectionOrders[template]);
  assert.equal(new Set(orders.map((order) => order.join(","))).size, pdfTemplateValues.length);
  for (const order of orders) {
    for (const required of ["skills", "experience", "education", "certifications"] as const) {
      assert.ok(order.includes(required));
    }
    assert.equal(Number(order.includes("projects")) + Number(order.includes("career_highlights")), 1);
  }
});

test("the supplied full template sample parses and retains its content", () => {
  const parsed = parsePdfPackage(JSON.stringify(sampleFull), { requireCoreSections: true });
  assert.deepEqual(
    parsed.resume.sections.map((section) => section.id),
    ["experience", "projects", "education", "skills", "certifications", "career_highlights"],
  );
  assert.equal(parsed.resume.sections[3].items[0].bullets?.[0], "AWS");
  // Dates come from startDate/endDate in one format; focus and work mode are kept.
  const job = parsed.resume.sections[0].items[0];
  assert.equal(job.dateRange, "Mar 2022 – Present");
  assert.deepEqual(job.focus, ["Kubernetes", "Terraform", "AWS"]);
  assert.equal(job.workMode, "Remote");
  assert.equal(parsed.resume.sections[4].items[0].dateRange, "May 2023");
  assert.deepEqual(parsed.coverLetter.recipient?.address, ["Example Street 10", "Bucharest, Romania"]);
  assert.equal(parsed.coverLetter.bodyParagraphs.length, 3);

  const adapted = toResumeTemplateData(parsed, "classic");
  assert.equal(adapted.theme.template, "classic");
  assert.deepEqual(adapted.candidate.links, []);
  assert.deepEqual(
    adapted.resume.sections.map((section) => section.title),
    ["Career Highlights", "Experience", "Education", "Skills", "Certifications"],
  );
  assert.equal(adapted.resume.sections[3].type, "skills");
  assert.equal(adapted.coverLetter.recipient?.company, "Example Employer");
});

test("the template adapter omits portfolio contact links but keeps other contact websites", () => {
  const candidate = {
    fullName: "Test Candidate",
    email: "test@example.com",
    links: [
      { label: " Portfolio ", url: "https://portfolio.example.com" },
      { label: "Personal website", url: "https://example.com" },
    ],
  };
  const packageWithLinks = {
    ...validPackage,
    resume: { ...validPackage.resume, candidate },
    coverLetter: { ...validPackage.coverLetter, candidate },
  };

  const adapted = toResumeTemplateData(
    parsePdfPackage(JSON.stringify(packageWithLinks)),
    "classic",
  );

  assert.deepEqual(adapted.candidate.links, [
    { label: "Personal website", url: "https://example.com" },
  ]);
  assert.deepEqual(adapted.coverLetter.candidate.links, [
    { label: "Personal website", url: "https://example.com" },
  ]);
});

test("the template adapter removes links from project sections but preserves other section links", () => {
  const packageWithProjectLink = {
    ...validPackage,
    resume: {
      ...validPackage.resume,
      sections: [
        {
          id: "selected-projects",
          title: "Selected Projects",
          items: [{ heading: "Dashboard", link: "https://example.com/dashboard" }],
        },
        {
          title: "Experience",
          items: [{ heading: "Coordinator", link: "https://example.com/experience" }],
        },
      ],
    },
  };

  const adapted = toResumeTemplateData(
    parsePdfPackage(JSON.stringify(packageWithProjectLink)),
    "qts-standard",
  );
  const section = (id: string) => adapted.resume.sections.find((entry) => entry.id === id);

  assert.equal(section("projects")?.items[0].link, undefined);
  assert.equal(section("experience")?.items[0].link, "https://example.com/experience");
});

test("every template prints projects as name, technologies and bullets, education without bullets, and skills without details", () => {
  const parsed = parsePdfPackage(JSON.stringify({
    ...generatedPackage,
    resume: {
      ...generatedPackage.resume,
      sections: [
        ...generatedPackage.resume.sections.filter((section) => !["projects", "education", "skills"].includes(section.id ?? "")),
        { id: "skills", title: "Skills", items: [{ heading: "Cloud", bullets: [{ name: "AWS", detail: "6 years" }, "GCP"] }] },
        { id: "education", title: "Education", items: [{ heading: "BSc", subheading: "University", bullets: ["Thesis"] }] },
        {
          id: "projects",
          title: "Projects",
          items: [{
            heading: "Cost reporter",
            subheading: "Personal project",
            startDate: "2023-01",
            endDate: "2023-08",
            focus: ["Go", "Kubernetes", "Helm", "Prometheus"],
            bullets: ["Built it."],
          }],
        },
      ],
    },
  }));
  for (const template of pdfTemplateValues) {
    const sections = toResumeTemplateData(parsed, template).resume.sections;
    const project = sections.find((section) => section.id === "projects")?.items[0];
    if (project) {
      assert.equal(project.dateRange, undefined, template);
      assert.equal(project.subheading, undefined, template);
      assert.deepEqual(project.focus, ["Go", "Kubernetes", "Helm", "Prometheus"], template);
    }
    assert.deepEqual(sections.find((section) => section.id === "education")?.items[0].bullets, [], template);
    assert.deepEqual(sections.find((section) => section.id === "skills")?.items[0].bullets, ["AWS", "GCP"], template);
  }
});

test("PDF document data rejects missing document sections", () => {
  assert.throws(
    () => parsePdfPackage(JSON.stringify({ resume: validPackage.resume })),
    /resume and coverLetter/,
  );
});
