import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POPULAR_ROLES, POPULAR_TOOLS, ROLES, TOOLS, TOOL_FILES, suggest } from "./work-kinds.ts";

test("the list of kinds of work is broad: well over 150, across industries", () => {
  assert.ok(ROLES.length >= 150, String(ROLES.length));
  for (const r of ["Accountant", "Tax preparer", "Bookkeeper", "Attorney", "Paralegal", "Consultant", "Designer", "Developer", "Marketer", "Recruiter", "Real estate agent", "Founder"]) assert.ok(ROLES.includes(r), r);
  assert.equal(new Set(ROLES).size, ROLES.length, "no duplicates");
});

test("type-ahead puts names that start with the text first, skips what is picked, and caps the list", () => {
  assert.deepEqual(suggest(ROLES, "acc", []).slice(0, 2), ["Accountant", "Account manager"]);
  assert.ok(!suggest(ROLES, "acc", ["Accountant"]).includes("Accountant"));
  assert.equal(suggest(ROLES, "a", []).length, 8);
  assert.deepEqual(suggest(ROLES, "  ", []), []);
  assert.ok(suggest(ROLES, "estate", []).includes("Real estate agent"), "a name that contains the text matches too");
});

test("every tool carries its own mark: an inline mark or a brand icon file that is in public/tools", () => {
  assert.ok(TOOLS.length >= 250, String(TOOLS.length));
  assert.deepEqual(suggest(TOOLS, "slack", [])[0], ["Slack", "slack"]);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const inline = new Set([...readFileSync(path.join(here, "ProviderLogo.tsx"), "utf8").matchAll(/"([a-z0-9]+)":\["[Mm]/g)].map((m) => m[1]));
  for (const [name, key] of TOOLS) {
    assert.notEqual(key, "", `${name} has no mark`);
    if (inline.has(key)) continue;
    const kind = TOOL_FILES[key];
    assert.ok(kind, `${name}: ${key} is neither inline nor a file`);
    assert.ok(existsSync(path.join(here, "../../public/tools", `${key}.${kind}`)), `${name}: public/tools/${key}.${kind} is missing`);
  }
  for (const n of ["Google Ads", "Meta Ads", "GoHighLevel", "Twilio", "Microsoft Excel"]) assert.notEqual(TOOLS.find((t) => t[0] === n)?.[1] ?? "", "", n);
  assert.equal(new Set(TOOLS.map((t) => t[0])).size, TOOLS.length, "no duplicate tools");
});

test("the popular picks shown before typing are all in the lists", () => {
  for (const n of POPULAR_TOOLS) assert.ok(TOOLS.some((t) => t[0] === n), n);
  for (const n of POPULAR_ROLES) assert.ok(ROLES.includes(n), n);
  assert.ok(ROLES.length >= 300, String(ROLES.length));
});
