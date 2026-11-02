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

test("generated resume location contains only city and country", () => {
  assert.equal(
    generationResumeLocation(candidateLocation),
    "Cluj-Napoca, Romania",
  );
});

test("generated resume location excludes street, province, and postal code for any candidate", () => {
  assert.equal(
    generationResumeLocation({
      ...candidateLocation,
      addressLine1: "Strada Bohatiel Alexandru, 22",
      city: "Baia Mare",
      province: "Maramureș",
      postalCode: "400476",
    }),
    "Baia Mare, Romania",
  );
});

test("missing city or country is omitted", () => {
  assert.equal(
    generationResumeLocation({ city: null, country: "Romania" }),
    "Romania",
  );
});
