import assert from "node:assert/strict";
import test from "node:test";
import { checkSummaryBold, cleanGeneratedDocuments, cleanText } from "@/server/generation/clean-documents";

const context = {
  company: "N-iX",
  jobTitle: "Senior DevOps Engineer",
  candidateName: "Andrei Sava",
  jobDescription: "We need Kubernetes, Terraform, AWS and GitOps experience for our EKS platform.",
  profileText: "Infrastructure automation with Terraform, Ansible, Kubernetes and AWS at Automaly.",
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

test("summary bold stays only for job keywords the candidate has, six at most", () => {
  assert.equal(
    checkSummaryBold("Engineer with **Kubernetes**, **Terraform**, **GitOps** and **Azure**.", context.jobDescription, context.profileText),
    "Engineer with **Kubernetes**, **Terraform**, GitOps and Azure.",
  );
  const many = Array.from({ length: 8 }, () => "**AWS**").join(" ");
  assert.equal((checkSummaryBold(many, "AWS", "AWS").match(/\*\*/g) ?? []).length, 12);
});

test("the package is cleaned without failing: bold only in summary and bullets, broken bullets left out", () => {
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
  assert.equal(resume.summary, "Engineer building **AWS** platforms with **Terraform** at N-iX and Azure.");
  const [experience, skills] = resume.sections as Record<string, unknown>[];
  assert.equal(experience.title, "Experience");
  const job = (experience.items as Record<string, unknown>[])[0];
  assert.equal(job.heading, "Automation Engineer");
  assert.deepEqual(job.bullets, ["Automated **Terraform** modules for 30 teams.", "Reduced deploy time by 40%."]);
  assert.deepEqual((skills.items as Record<string, unknown>[])[0].bullets, ["AWS", "Terraform"]);
  const letter = cleaned.coverLetter as Record<string, unknown>;
  assert.equal(letter.salutation, "Dear N-iX team,");
  assert.deepEqual(letter.bodyParagraphs, ["I bring Kubernetes experience."]);
  assert.equal(letter.signatureName, "Andrei Sava");
});
