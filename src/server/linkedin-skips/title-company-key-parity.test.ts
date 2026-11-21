import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";

// The extension matches LinkedIn cards with its own copy of the key (extension/shared/
// title-company-key.js): it must give exactly the server's key, or bids and skips would not match.
const extension = createRequire(import.meta.url)(resolve("extension/shared/title-company-key.js")) as {
  computeTitleCompanyKey: (title: string, company: string) => string;
};

// Real cards from a LinkedIn search (2026-11-21), plus names that test the edges.
const pairs: [string, string][] = [
  ["Senior DevOps Engineer (Azure+AWS)", "N-iX"],
  ["Senior Cloud Security Engineer", "Black Swans Exist"],
  ["Site Reliability Engineer II", "Akamai Technologies"],
  ["Senior Kubernetes & Reliability Engineer", "Verda"],
  ["Senior DevOps Engineer (GitHub Platform)", "SoftwareOne"],
  ["Staff DevOps Engineer", "Bloomreach"],
  ["Senior DevOps (AWS) IRC308628", "GlobalLogic"],
  ["Senior DevOps Engineer - Geospatial", "workfully"],
  ["Senior Devops Engineer", "Luxoft"],
  ["Senior MLOps / Edge AI Platform Engineer", "Billennium"],
  ["Senior DevOps Engineer (AWS CI/CD & Logging) IRC307201", "GlobalLogic"],
  ["Senior Site Reliability Engineer - AI/GPU", "TechShack"],
  ["Senior Cloud-Infrastructure Engineer (w/m/d)", "Finanzen invest"],
  ["Platform Infrastructure Engineer EU/UK remote (m/f/d)", "Pliant"],
  ["Principal Software Engineer - Akamai Inference Cloud - Remote/Poland", "Akamai Technologies"],
  ["Senior Kubernetes Experte / DevOps Engineer (w/m/d)", "HiSolutions AG"],
  ["Platform Engineer (m/w/d)", "QualityMinds GmbH"],
  ["Senior Cloud Engineer (AWS)", "Volkswagen Group Digital Solutions [Portugal]"],
  ["Data Engineer (Remote)", "Acme Inc."],
  ["Data Engineer - Hybrid, Berlin", "ACME Sp. z o.o."],
  ["Ingénieur Données", "Société Générale S.A."],
  ["Ｆｕｌｌｗｉｄｔｈ  Title", "Ｃｏｍｐａｎｙ Ltd"],
  ["", "Empty title Co"],
  ["Only title", ""],
];

test("the extension's title|company key is exactly the server's", () => {
  for (const [title, company] of pairs) {
    assert.equal(extension.computeTitleCompanyKey(title, company), computeTitleCompanyKey(title, company), `${title} | ${company}`);
  }
});

test("the key keeps different jobs apart and the same job together", () => {
  const key = extension.computeTitleCompanyKey;
  assert.notEqual(key("Senior DevOps Engineer", "Bloomreach"), key("Senior DevOps Engineer", "FP Markets"));
  assert.notEqual(key("Senior Cloud Engineer", "FP Markets"), key("Senior DevOps Engineer", "FP Markets"));
  assert.equal(key("Senior Devops Engineer", "Luxoft"), key("Senior DevOps Engineer", "LUXOFT"));
  assert.equal(key("Platform Engineer (m/w/d)", "QualityMinds GmbH"), key("Platform Engineer (m/w/d)", "QualityMinds"));
});
