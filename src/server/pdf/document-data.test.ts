import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import { sectionOrders, templateSectionOrders } from "@/app/pdf/resume-sections";
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
      { id: "projects", title: "Projects", items: [{ heading: "Settlement Platform", focus: ["Kafka"], bullets: ["Built the event pipeline"] }] },
      { id: "career_highlights", title: "Career Highlights", items: [{ bullets: ["Cut costs by 20%."] }] },
      { title: "Languages", items: [{ bullets: ["English"] }] },
      { title: "Volunteer Experience", items: [{ heading: "Helper" }] },
    ],
  },
};

const version2Package = {
  resume: {
    targetCompany: "Example",
    applyJobTitle: "Platform Engineer",
    name: "Test Candidate",
    title: "Platform Engineer | Cloud",
    contact: {
      location: "Cluj-Napoca, Romania",
      email: "test@example.com",
      linkedin: "linkedin.com/in/test-candidate",
      phone: "+40 123 456 789",
    },
    summary: "Platform engineer with **AWS** experience.",
    skills: [
      { category: "Cloud", items: "AWS, Kubernetes, Terraform" },
      { category: "Programming", items: "TypeScript, Go" },
    ],
    experience: [{
      company: "Example Ltd",
      location: "Cluj-Napoca, Romania",
      role: "Platform Engineer",
      dates: "Nov 2022 – Present",
      bullets: ["Built **reliable** cloud infrastructure.", "Automated production deployments."],
    }],
    education: [{
      institution: "Example University",
      location: "Cluj-Napoca, Romania",
      degree: "BSc",
      field: "Computer Science",
      dates: "Oct 2018 – Jun 2022",
    }],
  },
  coverLetter: {
    candidate: {
      fullName: "Test Candidate",
      email: "test@example.com",
      phone: "+40 123 456 789",
      location: "Cluj-Napoca, Romania",
      linkedinUrl: "linkedin.com/in/test-candidate",
    },
    targetRole: "Platform Engineer",
    targetCompany: "Example",
    recipient: { name: "", title: "Hiring Manager", company: "Example", address: [] },
    subject: "Application for Platform Engineer",
    salutation: "Dear Hiring Manager,",
    bodyParagraphs: ["I am applying for the Platform Engineer role."],
    closing: "Kind regards,",
    signatureName: "Test Candidate",
  },
};

test("PDF document data accepts one resume and cover-letter JSON object", () => {
  const parsed = parsePdfPackage(JSON.stringify(validPackage));
  assert.equal(parsed.resume.targetRole, "Engineer");
  assert.equal(parsed.resume.sections[0].id, "experience");
  assert.equal(parsed.coverLetter.targetCompany, "Example");
});

test("Version 1 saved résumé identity must continue to match the cover letter", () => {
  assert.throws(() => parsePdfPackage(JSON.stringify({
    ...validPackage,
    coverLetter: {
      ...validPackage.coverLetter,
      candidate: { fullName: "Different Candidate", email: "other@example.com" },
    },
  })), /candidate names and email addresses must match/);
});

test("Version 2 résumé normalizes for every existing template without projects", () => {
  const parsed = parsePdfPackage(JSON.stringify(version2Package), { requireCoreSections: true });
  assert.deepEqual(parsed.resume.sections.map((section) => section.id), ["skills", "experience", "education"]);
  assert.equal(parsed.resume.candidate.fullName, "Test Candidate");
  assert.equal(parsed.resume.candidate.headline, "Platform Engineer | Cloud");
  assert.equal(parsed.resume.candidate.linkedinUrl, "linkedin.com/in/test-candidate");
  assert.equal(parsed.resume.sections[0].type, "skills");
  assert.deepEqual(parsed.resume.sections[0].items[0].bullets, ["AWS", "Kubernetes", "Terraform"]);
  assert.equal(parsed.resume.sections[1].items[0].heading, "Platform Engineer");
  assert.equal(parsed.resume.sections[1].items[0].subheading, "Example Ltd");
  assert.equal(parsed.resume.sections[1].items[0].dateRange, "Nov 2022 – Present");
  assert.deepEqual(parsed.resume.sections[1].items[0].bullets, version2Package.resume.experience[0].bullets);
  assert.equal(parsed.resume.sections[2].items[0].heading, "BSc, Computer Science");
  assert.equal(parsed.resume.sections[2].items[0].subheading, "Example University");
  assert.equal(parsed.coverLetter.bodyParagraphs[0], version2Package.coverLetter.bodyParagraphs[0]);
  for (const template of pdfTemplateValues) {
    const data = toResumeTemplateData(parsed, template);
    assert.deepEqual(data.resume.sections.map((section) => section.id).sort(), ["education", "experience", "skills"], template);
    assert.equal(data.coverLetter.paragraphs[0], version2Package.coverLetter.bodyParagraphs[0], template);
  }
});

test("Version 2 résumé rejects unknown fields and mismatched cover-letter identity", () => {
  assert.throws(() => parsePdfPackage(JSON.stringify({
    ...version2Package,
    resume: { ...version2Package.resume, projects: [] },
  }), { requireCoreSections: true }), /resume must contain exactly/);
  assert.throws(() => parsePdfPackage(JSON.stringify({
    ...version2Package,
    coverLetter: { ...version2Package.coverLetter, candidate: { ...version2Package.coverLetter.candidate, email: "other@example.com" } },
  }), { requireCoreSections: true }), /candidate names and email addresses must match/);
});

test("sections get their fixed ids; languages, volunteering and empty sections are dropped", () => {
  const parsed = parsePdfPackage(JSON.stringify(generatedPackage), { requireCoreSections: true });
  assert.deepEqual(
    parsed.resume.sections.map((section) => section.id),
    ["experience", "skills", "education", "projects", "career_highlights"],
  );
  assert.equal(parsed.resume.sections[1].type, "skills");
  assert.equal(parsed.resume.sections[3].type, "standard");
});

test("generated JSON must have the summary and the skills, experience, projects and education sections", () => {
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
  const withoutProjects = {
    ...generatedPackage,
    resume: {
      ...generatedPackage.resume,
      sections: generatedPackage.resume.sections.filter((section) => section.id !== "projects"),
    },
  };
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withoutProjects), { requireCoreSections: true }),
    /must include projects/,
  );
  const withoutSummary = { ...generatedPackage, resume: { ...generatedPackage.resume, summary: "" } };
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withoutSummary), { requireCoreSections: true }),
    /resume.summary is required/,
  );
  // Stored packages still print without the generation-time requirement.
  assert.doesNotThrow(() => parsePdfPackage(JSON.stringify(withoutEducation)));
  assert.doesNotThrow(() => parsePdfPackage(JSON.stringify(withoutProjects)));
});

test("a required section whose entries print nothing counts as missing", () => {
  const withSection = (id: string, items: unknown[]) => ({
    ...generatedPackage,
    resume: {
      ...generatedPackage.resume,
      sections: generatedPackage.resume.sections.map((section) => (section.id === id ? { ...section, items } : section)),
    },
  });
  // Education bullets are never printed, so a degree written only as a bullet leaves Education empty.
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withSection("education", [{ bullets: ["BSc Computer Science, MIT"] }])), { requireCoreSections: true }),
    /must include education/,
  );
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withSection("skills", [{ heading: "Cloud", bullets: [] }])), { requireCoreSections: true }),
    /must include skills/,
  );
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withSection("experience", [{ location: "Berlin", focus: ["Go"] }])), { requireCoreSections: true }),
    /must include experience/,
  );
  // A project prints no dates or company, so one made only of those prints nothing.
  assert.throws(
    () => parsePdfPackage(JSON.stringify(withSection("projects", [{ subheading: "Acme", startDate: "2023-01" }])), { requireCoreSections: true }),
    /must include projects/,
  );
  assert.doesNotThrow(
    () => parsePdfPackage(JSON.stringify(withSection("education", [{ subheading: "MIT", startDate: "2015-09" }])), { requireCoreSections: true }),
  );
});

test("each template shows its own sections in its own order, with its own layout", () => {
  const parsed = parsePdfPackage(JSON.stringify(generatedPackage));
  const technical = toResumeTemplateData(parsed, "technical");
  // Career Highlights are in the JSON but no template prints them.
  assert.deepEqual(
    technical.resume.sections.map((section) => section.id),
    ["skills", "experience", "projects", "education"],
  );
  assert.deepEqual(technical.theme.sectionOrder, ["summary", "skills", "experience", "projects", "education"]);
  const executive = toResumeTemplateData(parsed, "executive");
  assert.deepEqual(
    executive.resume.sections.map((section) => section.id),
    ["education", "skills", "experience", "projects"],
  );
  // Layout options are no longer forced; the template's own design applies.
  assert.equal("skillsLayout" in executive.theme, false);
  assert.equal("bulletStyle" in executive.theme, false);
});

test("every template prints Experience, Projects, Skills and Education once, Education first or last, Projects after Experience", () => {
  for (const template of pdfTemplateValues) {
    const order = templateSectionOrders[template];
    assert.ok(sectionOrders.includes(order as (typeof sectionOrders)[number]), template);
    assert.deepEqual([...order].sort(), ["education", "experience", "projects", "skills"], template);
    assert.ok(order[0] === "education" || order.at(-1) === "education", template);
    assert.equal(order.indexOf("projects"), order.indexOf("experience") + 1, template);
  }
});

test("any four templates in a row of the rotation print different section orders", () => {
  const rotation = pdfTemplateValues.map((template) => templateSectionOrders[template].join(","));
  for (let start = 0; start < rotation.length; start += 1) {
    // The rotation starts again at Template 1 after Template 24.
    const run = [0, 1, 2, 3].map((offset) => rotation[(start + offset) % rotation.length]);
    assert.equal(new Set(run).size, 4, `templates ${start + 1} to ${start + 4}`);
  }
});

test("career highlights and certifications are read but never printed", () => {
  const parsed = parsePdfPackage(JSON.stringify({
    ...generatedPackage,
    resume: {
      ...generatedPackage.resume,
      sections: [
        ...generatedPackage.resume.sections,
        { id: "certifications", title: "Certifications", items: [{ heading: "AWS Solutions Architect" }] },
      ],
    },
  }));
  for (const template of pdfTemplateValues) {
    assert.deepEqual(
      toResumeTemplateData(parsed, template).resume.sections.map((section) => section.id).sort(),
      ["education", "experience", "projects", "skills"],
      template,
    );
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
    // Standard titles, whatever the JSON calls the sections.
    ["Education", "Skills", "Professional Experience", "Selected Projects"],
  );
  assert.equal(adapted.resume.sections[1].type, "skills");
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

  assert.equal(section("projects")?.items[0].heading, "Dashboard");
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
    assert.equal(project?.heading, "Cost reporter", template);
    assert.equal(project?.dateRange, undefined, template);
    assert.equal(project?.subheading, undefined, template);
    assert.deepEqual(project?.focus, ["Go", "Kubernetes", "Helm", "Prometheus"], template);
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
