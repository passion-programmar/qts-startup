import assert from "node:assert/strict";
import test from "node:test";
import { describeResumeShape } from "./response-shape";

test("an answer with experience outside resume.sections says where everything is", () => {
  const shape = describeResumeShape({
    resume: {
      candidate: {}, summary: "x",
      sections: [
        { id: "skills", items: [{ heading: "AI", bullets: ["Python"] }] },
        { id: "projects", entries: [{ heading: "P" }] },
      ],
      experience: [{ title: "Engineer" }],
      education: [],
    },
    coverLetter: {},
  });
  assert.equal(shape, "Found: resume keys candidate, summary, sections, experience, education; sections: skills (1 items: heading/bullets), projects (no items list; lists under entries).");
});

test("sections as an object, or no resume at all, are named", () => {
  assert.equal(describeResumeShape({ resume: { sections: { experience: [] } } }), "Found: resume keys sections; resume.sections is an object, not a list.");
  assert.equal(describeResumeShape({ coverLetter: {} }), "Found: no resume object.");
});
