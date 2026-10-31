import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { generationOutputIssue, type GenerationOutputFacts } from "@/server/generation/generation-output-validation";

const response = {
  resume: {
    targetCompany: "Example Corp",
    applyJobTitle: "Platform Engineer",
    name: "Ana Popescu",
    title: "Software Engineer",
    contact: {
      location: "Brașov, Romania",
      email: "ana@example.com",
      linkedin: "https://linkedin.com/in/ana",
      phone: "+40 721 123 456",
    },
    summary: "Experienced engineer.",
    skills: [{ category: "Engineering", items: "TypeScript, PostgreSQL" }],
    experience: [{
      company: "Example Labs",
      location: "Brașov",
      role: "Senior Engineer",
      dates: "Jan 2020 – Present",
      bullets: ["Built reliable systems."],
    }],
    education: [{
      institution: "Example University",
      location: "",
      degree: "BSc",
      field: "Computer Science",
      dates: "Sep 2015 – Jun 2019",
    }],
  },
  coverLetter: {
    candidate: {
      fullName: "Ana Popescu",
      email: "ana@example.com",
      phone: "+40 721 123 456",
      location: "Brașov, Romania",
      linkedinUrl: "https://linkedin.com/in/ana",
    },
    targetRole: "Platform Engineer",
    targetCompany: "Example Corp",
    recipient: { name: "", title: "Hiring Manager", company: "Example Corp", address: [] },
    subject: "Application for Platform Engineer",
    salutation: "Dear Hiring Manager,",
    bodyParagraphs: ["I am applying for the Platform Engineer role."],
    closing: "Kind regards,",
    signatureName: "Ana Popescu",
  },
};

const facts: GenerationOutputFacts = {
  candidate: {
    fullName: "Ana Popescu",
    email: "ana@example.com",
    phone: "+40 721 123 456",
    linkedinUrl: "https://www.linkedin.com/in/ana/",
    location: "Brașov, Romania",
  },
  job: { title: "Platform Engineer", company: "Example Corp" },

};

function parsedPackage(value: typeof response = response) {
  return parsePdfPackage(JSON.stringify(value), { requireCoreSections: true });
}

test("accepts schema-valid documents with matching identity and target", () => {
  assert.equal(generationOutputIssue(parsedPackage(), facts), null);
});

test("Manager-controlled headline, skills, ATS wording and experience are not source-matched", () => {
  const changed = structuredClone(response);
  changed.resume.title = "Cloud Platform and Engineering Leader";
  changed.resume.summary = "Leadership across Kubernetes, Azure and distributed systems.";
  changed.resume.skills[0].items = "Kubernetes, Azure, Java, C++, C#, SQL, arbitrary technical terminology";
  changed.resume.experience[0].role = "Engineering Lead";
  changed.resume.experience[0].company = "Another employer";
  changed.resume.experience[0].dates = "2018 ? 2025";
  changed.resume.experience[0].bullets = ["Led teams.", "Designed Kubernetes platforms.", "Mentored engineers."];
  changed.coverLetter.bodyParagraphs = ["My leadership and technical background align with your platform strategy."];
  assert.equal(generationOutputIssue(parsedPackage(changed), facts), null);
});

test("additional and rewritten experience and education pass without source-fact matching", () => {
  const changed = structuredClone(response);
  changed.resume.experience.push({ ...changed.resume.experience[0], company: "Additional employer" });
  changed.resume.education[0].degree = "MSc";
  changed.resume.education[0].field = "Information Technology";
  changed.resume.education[0].dates = "2019 ? 2021";
  changed.resume.education.push({ ...changed.resume.education[0], institution: "Additional university" });
  assert.equal(generationOutputIssue(parsedPackage(changed), facts), null);
});

test("essential saved identity and target checks remain enforced", () => {
  const changes: Array<(value: typeof response) => void> = [
    (value) => { value.resume.name = "Other Person"; value.coverLetter.candidate.fullName = "Other Person"; },
    (value) => { value.resume.contact.email = "a.na@example.com"; value.coverLetter.candidate.email = "a.na@example.com"; },
    (value) => { value.resume.contact.phone = "+40 722 000 000"; },
    (value) => { value.coverLetter.candidate.linkedinUrl = "https://linkedin.com/in/other"; },
    (value) => { value.resume.contact.location = "Another City"; },
    (value) => { value.resume.applyJobTitle = "Cloud Engineer"; value.coverLetter.targetRole = "Cloud Engineer"; },
    (value) => { value.resume.targetCompany = "Other Corp"; value.coverLetter.targetCompany = "Other Corp"; },
    (value) => { value.coverLetter.signatureName = "Other Person"; },
  ];
  for (const change of changes) {
    const changed = structuredClone(response);
    change(changed);
    assert.ok(generationOutputIssue(parsedPackage(changed), facts));
  }
});

test("optional saved contacts cannot be filled with unrelated contact information", () => {
  for (const field of ["phone", "linkedinUrl", "location"] as const) {
    const saved = structuredClone(facts);
    saved.candidate[field] = "";
    assert.match(generationOutputIssue(parsedPackage(), saved) ?? "", /saved contact details/);
  }
});

test("V2 schema, email format and cover-letter validation still reject invalid documents", () => {
  const missing = structuredClone(response) as Record<string, unknown>;
  delete (missing.resume as Record<string, unknown>).skills;
  assert.throws(() => parsePdfPackage(JSON.stringify(missing), { requireCoreSections: true }));
  const invalidEmail = structuredClone(response);
  invalidEmail.resume.contact.email = "invalid-email";
  assert.throws(() => parsedPackage(invalidEmail), /email/);
  for (const paragraphs of [[], [""], ["a".repeat(901)], Array(7).fill("A paragraph.")]) {
    const changed = structuredClone(response);
    changed.coverLetter.bodyParagraphs = paragraphs;
    assert.throws(() => parsedPackage(changed), /bodyParagraphs/);
  }
  const valid = structuredClone(response);
  valid.coverLetter.bodyParagraphs = ["a".repeat(900)];
  assert.equal(generationOutputIssue(parsedPackage(valid), facts), null);
});
