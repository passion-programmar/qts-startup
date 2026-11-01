import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { categories, managerApplyAnswers, profiles, users } from "@/db/schema";

const testDatabaseUrl = process.env.QTS_TEST_DATABASE_URL;
test("concurrent Check saves retain equivalent wording variants in Postgres", { skip: !testDatabaseUrl && "QTS_TEST_DATABASE_URL is not set" }, async () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  const require = Module.createRequire(__filename), serverOnly = require.resolve("server-only");
  require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  const [{ db }, { saveManagerCorrection }] = await Promise.all([import("@/lib/db"), import("./manager-answers")]);
  const [manager] = await db.select({ id: users.id }).from(users).where(eq(users.role, "manager")).limit(1);
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.isDefault, true)).limit(1);
  assert.ok(manager && category, "the isolated test database must have a Manager and default category");
  const candidateId = randomUUID(), question = `Application source qts-test-${randomUUID()}`;
  try {
    await db.insert(users).values({ id: candidateId, role: "account", parentUserId: manager.id });
    await db.insert(profiles).values({ userId: candidateId, categoryId: category.id, firstName: "Synthetic", lastName: "Test" });
    const outcomes = await Promise.all([
      saveManagerCorrection(manager.id, candidateId, randomUUID(), { question, answer: "LinkedIn", kind: "text" }),
      saveManagerCorrection(manager.id, candidateId, randomUUID(), { question, answer: "LinkedIn Job Post", kind: "select", options: ["LinkedIn Job Post", "Indeed"] }),
    ]);
    assert.ok(outcomes.every((result) => result.ok));
    const [saved] = await db.select().from(managerApplyAnswers).where(and(eq(managerApplyAnswers.managerId, manager.id), eq(managerApplyAnswers.questionText, question)));
    assert.equal(saved.scope, "manager");
    assert.deepEqual(new Set(saved.variants.map((variant) => variant.answer)), new Set(["LinkedIn", "LinkedIn Job Post"]));
  } finally {
    await db.delete(managerApplyAnswers).where(and(eq(managerApplyAnswers.managerId, manager.id), eq(managerApplyAnswers.questionText, question)));
    await db.delete(profiles).where(eq(profiles.userId, candidateId));
    await db.delete(users).where(eq(users.id, candidateId));
  }
});
