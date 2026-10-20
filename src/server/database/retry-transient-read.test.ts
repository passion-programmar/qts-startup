import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientDatabaseConnectionError,
  retryTransientDatabaseRead,
} from "./retry-transient-read";

test("recognizes a nested Neon fetch failure as transient", () => {
  const error = new Error("Failed query", {
    cause: new Error("Error connecting to database", {
      cause: Object.assign(new TypeError("fetch failed"), { code: "ETIMEDOUT" }),
    }),
  });

  assert.equal(isTransientDatabaseConnectionError(error), true);
  assert.equal(
    isTransientDatabaseConnectionError(new Error("column does not exist")),
    false,
  );
});

test("retries one transient read and returns its result", async () => {
  let attempts = 0;
  let waits = 0;
  const result = await retryTransientDatabaseRead(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return "connected";
    },
    async () => {
      waits += 1;
    },
  );

  assert.equal(result, "connected");
  assert.equal(attempts, 2);
  assert.equal(waits, 1);
});

test("does not retry non-network database errors", async () => {
  let attempts = 0;
  await assert.rejects(
    retryTransientDatabaseRead(async () => {
      attempts += 1;
      throw new Error("relation does not exist");
    }),
    /relation does not exist/,
  );
  assert.equal(attempts, 1);
});
