import assert from "node:assert/strict";
import test from "node:test";
import { cleanGeneratedDocuments, cleanText } from "@/server/generation/clean-documents";

const context = {
  company: "N-iX",
  jobTitle: "Senior DevOps Engineer",
  candidateName: "Andrei Sava",
};

test("stray symbols, HTML, emojis and invisible characters are removed; normal punctuation stays", () => {
  assert.equal(cleanText("Built `CI/CD` with <b>C#</b> and C++ 🚀 ✅ for 40% faster​ releases *", context), "Built CI/CD with C# and C++ for 40% faster releases");
  assert.equal(cleanText("**Kubernetes** platform", context), "Kubernetes platform");
  assert.equal(cleanText("**Kubernetes** platform and **AWS", context, { bold: true }), "**Kubernetes** platform and AWS");
  assert.equal(cleanText("- • Led the migration", context, { marker: true }), "Led the migration");
  assert.equal(cleanText("## Summary", context), "Summary");
});

test("placeholders are filled from the job and candidate, or taken out", () => {
  assert.equal(cleanText("I am excited to join [Company] as {{job_title}}.", context), "I am excited to join N-iX as Senior DevOps Engineer.");
  assert.equal(cleanText("Regards, [Your Name]", context), "Regards, Andrei Sava");
  assert.equal(cleanText("Cut costs by [X%] across [insert number] clusters.", context), "Cut costs by across clusters.");
  assert.equal(cleanText("Improved uptime (XX%).", context), "Improved uptime.");
});

test("cleanup preserves Manager-selected summary emphasis without keyword matching or a bold quota", () => {
  const summary = Array.from({ length: 8 }, (_, index) => `**Technical phrase ${index}**`).join(" ");
  for (const resume of [{ summary, candidate: {}, sections: [] }, {
    targetCompany: "N-iX", applyJobTitle: "Senior DevOps Engineer", name: "Andrei Sava",
    title: "Tailored headline", contact: {}, summary, skills: [], experience: [], education: [],
  }]) {
    const cleaned = cleanGeneratedDocuments({ resume }, context);
    assert.equal((cleaned.resume as Record<string, unknown>).summary, summary);
  }
});

test("the package is cleaned without failing: allowed bold and short bullets stay", () => {
  const cleaned = cleanGeneratedDocuments({
    resume: {
      candidate: { fullName: "**Andrei Sava**", email: "a@example.com" },
      targetRole: "Senior DevOps Engineer 🚀",
      summary: "Engineer building **AWS** platforms with **Terraform** at [Company] and **Azure**.",
      sections: [
        { id: "experience", title: "**Experience**", items: [{
          heading: "**Automation Engineer**",
          subheading: "Automaly",
          bullets: ["Automated **Terraform** modules for 30 teams.", "Improved [X%].", "- Reduced deploy time by 40%."],
        }] },
        { id: "skills", title: "Skills", items: [{ heading: "Cloud", bullets: ["**AWS**", "Terraform ✅"] }] },
      ],
    },
    coverLetter: { salutation: "Dear [Company] team,", bodyParagraphs: ["I bring **Kubernetes** experience.", "🚀"], closing: "Regards,", signatureName: "[Your Name]" },
  }, context);
  const resume = cleaned.resume as Record<string, unknown>;
  assert.equal((resume.candidate as Record<string, unknown>).fullName, "Andrei Sava");
  assert.equal(resume.targetRole, "Senior DevOps Engineer");
  assert.equal(resume.summary, "Engineer building **AWS** platforms with **Terraform** at N-iX and **Azure**.");
  const [experience, skills] = resume.sections as Record<string, unknown>[];
  assert.equal(experience.title, "Experience");
  const job = (experience.items as Record<string, unknown>[])[0];
  assert.equal(job.heading, "Automation Engineer");
  assert.deepEqual(job.bullets, ["Automated **Terraform** modules for 30 teams.", "Improved.", "Reduced deploy time by 40%."]);
  assert.deepEqual((skills.items as Record<string, unknown>[])[0].bullets, ["AWS", "Terraform"]);
  const letter = cleaned.coverLetter as Record<string, unknown>;
  assert.equal(letter.salutation, "Dear N-iX team,");
  assert.deepEqual(letter.bodyParagraphs, ["I bring Kubernetes experience."]);
  assert.equal(letter.signatureName, "Andrei Sava");
});

test("Version 2 résumé cleaning preserves its JSON shape, all bullets, skills, and Manager-selected bold", () => {
  const cleaned = cleanGeneratedDocuments({
    resume: {
      targetCompany: "N-iX",
      applyJobTitle: "Senior DevOps Engineer",
      name: "Andrei Sava",
      title: "Platform Engineer",
      contact: {
        location: "Cluj-Napoca, Romania",
        email: "a@example.com",
        linkedin: "linkedin.com/in/andrei",
        phone: "+40 123",
      },
      summary: "Engineer with **AWS** experience.",
      skills: [{ category: "Cloud", items: "AWS, Terraform, Kubernetes" }],
      experience: [{
        company: "Automaly",
        location: "Romania",
        role: "Platform Engineer",
        dates: "2020 – Present",
        bullets: ["Built **AWS** infrastructure across teams.", "Improved deployment reliability."],
      }],
      education: [{
        institution: "University",
        location: "Romania",
        degree: "BSc",
        field: "Computer Science",
        dates: "2015 – 2019",
      }],
    },
    coverLetter: {
      candidate: { fullName: "Andrei Sava", email: "a@example.com" },
      targetRole: "Senior DevOps Engineer",
      targetCompany: "N-iX",
      recipient: { name: "", title: "Hiring Manager", company: "N-iX", address: [] },
      subject: "Application",
      salutation: "Dear Hiring Manager,",
      bodyParagraphs: ["I bring **AWS** experience."],
      closing: "Kind regards,",
      signatureName: "Andrei Sava",
    },
  }, context);
  const resume = cleaned.resume as Record<string, unknown>;
  assert.deepEqual(Object.keys(resume), [
    "targetCompany", "applyJobTitle", "name", "title", "contact", "summary", "skills", "experience", "education",
  ]);
  assert.equal(resume.summary, "Engineer with **AWS** experience.");
  assert.deepEqual((resume.skills as { items: string }[])[0].items, "AWS, Terraform, Kubernetes");
  const experience = (resume.experience as Record<string, unknown>[])[0];
  assert.deepEqual(experience.bullets, [
    "Built **AWS** infrastructure across teams.",
    "Improved deployment reliability.",
  ]);
  assert.deepEqual(Object.keys(cleaned.coverLetter as Record<string, unknown>), [
    "candidate", "targetRole", "targetCompany", "recipient", "subject", "salutation",
    "bodyParagraphs", "closing", "signatureName",
  ]);
  assert.deepEqual((cleaned.coverLetter as Record<string, unknown>).bodyParagraphs, ["I bring AWS experience."]);
});
