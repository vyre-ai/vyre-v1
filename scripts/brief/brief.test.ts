import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildBrief, checklistOf, estimateTokens, MAX_TOKENS, type BriefInput } from "./build.ts";

const template = fs.readFileSync(new URL("../../docs/lanes/TEMPLATE.md", import.meta.url), "utf8");

const tracker = (id: string) => `PACKET ${id}: sample
CHECKLIST (trk check ${id} <n>):
  1. [ ] (setup) Read the sections
  2. [ ] (test) Write and pass the test
REQUIRED PROOFS: test_run

WORKFLOW: trk start ${id}`;

const samples: BriefInput[] = [
  { id: "P-A", title: "Small packet", trackerBrief: tracker("P-A"), owns: ["lib/a.ts"], laneDoc: "short lane note" },
  {
    id: "P-B", title: "Many globs", trackerBrief: tracker("P-B"),
    owns: Array.from({ length: 40 }, (_, i) => `modules/m${i}/**`),
    laneDoc: "lane ".repeat(2000), spec: ["4.12", "5 b12"], tests: ["kernel/x.test.ts"], budgets: ["write p95 under 10 ms"], proofs: ["test_run", "perf"],
  },
  { id: "P-C", title: "Huge lane doc", trackerBrief: tracker("P-C"), owns: ["sync/**", "client/src/store/**"], laneDoc: "word ".repeat(20000) },
];

test("builder output for three sample packets is under 6k tokens and lists every owned glob", () => {
  for (const s of samples) {
    const out = buildBrief(s, template);
    assert.ok(estimateTokens(out) <= MAX_TOKENS, `${s.id} is ${estimateTokens(out)} tokens`);
    for (const g of s.owns) assert.ok(out.includes(g), `${s.id} is missing ${g}`);
    assert.ok(out.includes(`${s.id}: ${s.title}`));
    assert.ok(!/\{\{\w+\}\}/.test(out), "no placeholder is left unfilled");
  }
});

test("the lane doc is cut only when needed, and the cut is marked", () => {
  assert.ok(!buildBrief(samples[0], template).includes("lane doc cut"));
  assert.ok(buildBrief(samples[2], template).includes("lane doc cut to fit"));
});

test("the checklist and proof kinds come through", () => {
  const out = buildBrief(samples[1], template);
  assert.match(out, /1\. \[ \] \(setup\) Read the sections/);
  assert.match(out, /Required proof kinds: test_run, perf\./);
  assert.equal(checklistOf("no list here"), "(none in the tracker brief)");
});

test("owned globs that alone exceed the budget fail loudly", () => {
  const big: BriefInput = { id: "P-D", title: "x", trackerBrief: tracker("P-D"), owns: Array.from({ length: 6000 }, (_, i) => `dir/${i}/**`) };
  assert.throws(() => buildBrief(big, template), /over 6000 tokens/);
});
