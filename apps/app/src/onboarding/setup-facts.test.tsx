// Nothing that cannot be done is offered (prototype amendment 3): a row is shown only where it can be done on this device and in this state.
import test from "node:test";
import assert from "node:assert/strict";
import { setupRows } from "./setup-rows.ts";
import { countsOn, rowFacts, visibleSteps } from "./device.ts";
import { resumeInfo, startedSetup } from "./ResumeChip.tsx";

const keys = (flow: "personal" | "team" | "member", facts: Parameters<typeof setupRows>[3]): string[] =>
  setupRows(flow, {}, "mac", facts).map((r) => r.key);

test("a first-win row waits for an AI account", () => {
  assert.ok(!keys("personal", { ai: false }).includes("win"));
  assert.ok(keys("personal", { ai: true }).includes("win"));
  assert.ok(keys("personal", {}).includes("win"), "unknown facts hide nothing");
});

test("Add Chrome needs a browser that can install it; Pair your phone needs an address a phone can open", () => {
  assert.ok(!keys("personal", { chrome: false }).includes("chrome"));
  assert.ok(keys("personal", { chrome: true }).includes("chrome"));
  assert.ok(!keys("personal", { phone: false }).includes("phone"));
  assert.ok(keys("personal", { phone: true }).includes("phone"));
});

test("a member's mail, calendar and files row needs a company connection", () => {
  assert.ok(!keys("member", { company: false }).includes("mine"));
  assert.ok(keys("member", { company: true }).includes("mine"));
});

test('the team\'s "name your Space" row is not shown once the Space has its name', () => {
  assert.ok(keys("team", { unnamed: true }).includes("org"));
  assert.ok(!keys("team", { unnamed: false }).includes("org"));
  assert.ok(keys("team", {}).includes("org"), "unknown facts hide nothing");
});

test("one list for the rows and the count: the title bar's total is the number of rows shown, whatever the facts", () => {
  const all = [
    {},
    { ai: false },
    { chrome: false, phone: false },
    { unnamed: false },
    { ai: false, chrome: false, phone: false, unnamed: false, company: false },
  ];
  for (const flow of ["personal", "team", "member"] as const)
    for (const facts of all) {
      const rows = setupRows(flow, {}, "web", facts);
      assert.equal(countsOn(flow, {}, "web", facts).total, rows.length, `${flow} ${JSON.stringify(facts)}`);
      assert.equal(visibleSteps(flow, "web", facts).length, rows.length);
      assert.equal(resumeInfo(flow, {}, "web", facts)?.total, rows.length);
    }
  // four rows visible never read "of 6": a done step still counts, a hidden one does not
  const facts = { ai: false, chrome: false, phone: false };
  assert.equal(
    countsOn("personal", { ai: "done" }, "web", facts).total,
    setupRows("personal", { ai: "done" }, "web", facts).length,
  );
  assert.equal(startedSetup("personal", { ai: "done" }, "web", facts), true);
});

test("the page's own facts: a phone-reachable address and a browser that can install the extension", () => {
  const f = rowFacts({ ai: "done" }, "mac", { company: false, unnamed: false });
  assert.deepEqual([f.ai, f.chrome, f.company, f.unnamed], [true, true, false, false]);
  assert.equal(rowFacts({}, "phone").chrome, false, "a phone has no Chrome extension row");
});
