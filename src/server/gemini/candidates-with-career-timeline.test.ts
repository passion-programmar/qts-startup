import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { careerTimelineSql } from "./candidates-with-career-timeline";

test("the career timeline sends only the title, company and months; isCurrent only on the current job", () => {
  const query = new PgDialect().sqlToQuery(careerTimelineSql(sql`p.user_id`)).sql;
  // Empty values are left out instead of being sent as null.
  assert.match(query, /json_strip_nulls\(json_build_object\(/);
  assert.match(query, /'jobTitle', btrim\(e\.job_title\)/);
  assert.match(query, /'companyName', nullif\(btrim\(e\.company_name\), ''\)/);
  assert.match(query, /'start', to_char\(e\.start_date, 'YYYY-MM'\)/);
  // A current job has no end; a previous job has its end and no isCurrent.
  assert.match(query, /'end', case when e\.is_current then null else to_char\(e\.end_date, 'YYYY-MM'\) end/);
  assert.match(query, /'isCurrent', case when e\.is_current then true end/);
  assert.doesNotMatch(query, /location|description/);
  assert.match(query, /order by e\.is_current desc/);
  assert.match(query, /e\.profile_user_id = p\.user_id and btrim\(e\.job_title\) <> ''/);
});
