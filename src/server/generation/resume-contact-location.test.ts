import assert from "node:assert/strict";
import test from "node:test";
import { generationResumeLocation } from "./resume-contact-location";

const candidateLocation = {
  addressLine1: "37, Strada Firiza",
  city: "Cluj-Napoca",
  province: "Cluj",
  country: "Romania",
  postalCode: "400659",
};

test("the requested candidate's generated resume location contains only city and country", () => {
  assert.equal(
    generationResumeLocation("427c4d75-1eb3-4d57-83c0-de054faad75a", candidateLocation),
    "Cluj-Napoca, Romania",
  );
});

test("other candidates retain the existing full generated resume location", () => {
  assert.equal(
    generationResumeLocation("another-candidate", candidateLocation),
    "37, Strada Firiza, Cluj-Napoca, Cluj, Romania, 400659",
  );
});
