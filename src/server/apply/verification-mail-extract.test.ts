import assert from "node:assert/strict";
import test from "node:test";
import { findCode, findLink, fromJobSite, htmlToText, pickVerification, siteTokens, type VerificationMail } from "./verification-mail-extract";

const mail = (over: Partial<VerificationMail>): VerificationMail => ({
  uid: 1,
  receivedAt: new Date("2026-11-17T10:00:00Z"),
  fromAddress: "no-reply@us.greenhouse-mail.io",
  fromName: "Acme Robotics",
  recipients: ["anna@gmail.com"],
  subject: "Your verification code",
  text: "",
  html: "",
  ...over,
});

test("site words come from the job addresses and the company, without generic words", () => {
  assert.deepEqual(
    siteTokens(["https://job-boards.greenhouse.io/acmerobotics/jobs/123", "https://careers.acme.com/jobs/9"], "Acme Robotics GmbH").sort(),
    ["acme", "greenhouse", "robotics"].sort(),
  );
});

test("a sender counts as the job site when its address, name or subject names the site", () => {
  const tokens = siteTokens(["https://job-boards.greenhouse.io/acme/jobs/1"], "Acme");
  assert.equal(fromJobSite(mail({}), tokens), true);
  assert.equal(fromJobSite(mail({ fromAddress: "news@shop.example", fromName: "Shop", subject: "Sale" }), tokens), false);
});

test("codes: Greenhouse, Workday-style, spaced, alphanumeric; never a year or a phone number", () => {
  assert.equal(findCode("Security code", "Copy and paste this code into the security code field on your application: Xy7Kp2Qa"), "Xy7Kp2Qa");
  assert.equal(findCode("Verify your account", "Your one-time verification code is 482913. It expires in 10 minutes."), "482913");
  assert.equal(findCode("", "Use the code below to sign in\n\n 593 204 \n\n© 2026 Workday, Inc."), "593204");
  assert.equal(findCode("Welcome", "Thanks for applying in 2026. Call us at +48 600 123 456."), null);
  assert.equal(findCode("Your code", "Enter 2026 is not a code. Your code: 7Q4M2B"), "7Q4M2B");
});

test("HTML mails: the code in a big heading next to its title", () => {
  const html = "<html><head><style>.x{}</style></head><body><h1>Verification code</h1><div style='font-size:32px'>  735 019 </div><p>&copy; 2026</p></body></html>";
  assert.equal(findCode("Confirm your email", htmlToText(html)), "735019");
});

test("links: only a verify / confirm link that goes to the job site", () => {
  const tokens = siteTokens(["https://acme.wd3.myworkdayjobs.com/en-US/External/job/1"], "Acme");
  const html = `<a href="https://click.sendgrid.net/ls/abc">Verify your email</a>
    <a href="https://acme.wd3.myworkdayjobs.com/en-US/External/activate?token=a1&amp;u=2">Verify your account</a>
    <a href="https://acme.wd3.myworkdayjobs.com/privacy">Privacy</a>`;
  assert.equal(findLink(html, "", tokens), "https://acme.wd3.myworkdayjobs.com/en-US/External/activate?token=a1&u=2");
  assert.equal(findLink('<a href="https://click.sendgrid.net/ls/abc">Verify</a>', "", tokens), null);
});

test("the mail to use: addressed to the candidate and from the site, newest first; used codes skipped", () => {
  const tokens = siteTokens(["https://job-boards.greenhouse.io/acme/jobs/1"], "Acme");
  const mails = [
    mail({ uid: 1, receivedAt: new Date("2026-11-17T10:00:00Z"), text: "Your verification code is 111111" }),
    mail({ uid: 2, receivedAt: new Date("2026-11-17T10:01:00Z"), text: "Your verification code is 222222" }),
    mail({ uid: 3, receivedAt: new Date("2026-11-17T10:02:00Z"), recipients: ["ben@gmail.com"], text: "Your verification code is 333333" }),
  ];
  assert.deepEqual(pickVerification(mails, { candidateEmail: "Anna@Gmail.com", tokens }), { uid: 2, code: "222222", link: null, fromSite: true });
  assert.deepEqual(pickVerification(mails, { candidateEmail: "anna@gmail.com", tokens, exclude: ["222222"] }), { uid: 1, code: "111111", link: null, fromSite: true });
  assert.equal(pickVerification(mails, { candidateEmail: "cara@gmail.com", tokens }), null);
});

test("an unknown sender: a lone code is used, a link never", () => {
  const tokens = siteTokens(["https://jobs.lever.co/acme/1"], "Acme");
  const other = { fromAddress: "hello@mailer.example", fromName: "Hiring", subject: "Your code" };
  assert.deepEqual(
    pickVerification([mail({ ...other, text: "Your code: 640212" })], { candidateEmail: "anna@gmail.com", tokens }),
    { uid: 1, code: "640212", link: null, fromSite: false },
  );
  assert.equal(pickVerification([
    mail({ ...other, uid: 1, text: "Your code: 640212" }),
    mail({ ...other, uid: 2, text: "Your code: 778899" }),
  ], { candidateEmail: "anna@gmail.com", tokens }), null);
  assert.equal(pickVerification([mail({ ...other, subject: "Confirm", html: '<a href="https://evil.example/verify">Verify</a>' })], { candidateEmail: "anna@gmail.com", tokens }), null);
});
