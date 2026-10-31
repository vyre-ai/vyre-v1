import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, TOOLS, suggest } from "./work-kinds.ts";

test("the list of kinds of work is broad: well over 150, across industries", () => {
  assert.ok(ROLES.length >= 150, String(ROLES.length));
  for (const r of ["Accountant", "Tax preparer", "Bookkeeper", "Attorney", "Paralegal", "Consultant", "Designer", "Developer", "Marketer", "Recruiter", "Real estate agent", "Founder"]) assert.ok(ROLES.includes(r), r);
  assert.equal(new Set(ROLES).size, ROLES.length, "no duplicates");
});

test("type-ahead puts names that start with the text first, skips what is picked, and caps the list", () => {
  assert.deepEqual(suggest(ROLES, "acc", []).slice(0, 2), ["Accountant", "Account manager"]);
  assert.ok(!suggest(ROLES, "acc", ["Accountant"]).includes("Accountant"));
  assert.equal(suggest(ROLES, "a", []).length, 6);
  assert.deepEqual(suggest(ROLES, "  ", []), []);
  assert.ok(suggest(ROLES, "estate", []).includes("Real estate agent"), "a name that contains the text matches too");
});

test("tools carry a logo key where we have the mark", () => {
  assert.ok(TOOLS.length >= 70);
  assert.deepEqual(suggest(TOOLS, "slack", [])[0], ["Slack", "slack"]);
  assert.equal(TOOLS.find((t) => t[0] === "Twilio")?.[1], "");
});
