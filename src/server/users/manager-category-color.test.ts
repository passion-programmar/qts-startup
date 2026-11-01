import assert from "node:assert/strict";
import test from "node:test";
import { isManagerCategoryColor, managerCategoryColors } from "./manager-category-color";

test("category color accepts no color or one of the visible presets", () => {
  assert.equal(managerCategoryColors.length, 14);
  assert.equal(isManagerCategoryColor(""), true);
  for (const { value } of managerCategoryColors) assert.equal(isManagerCategoryColor(value), true);
  assert.equal(isManagerCategoryColor("#123456"), false);
  assert.equal(isManagerCategoryColor("red"), false);
});
