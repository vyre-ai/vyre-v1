// The flow and the docs say the same thing. Each step on screen opens a section of the guide, so every step has one, in the order the flow runs; what Vyre asks a provider for is what the page lists; and the copy that ships in the app is the doc.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOC_PAGE, FLOW_STEPS, docSection } from "../lib/company-flow.ts";
import type { CompanyProvider } from "../lib/company-flow.ts";
import { DATA_SCOPES, DIRECTORY_SCOPE } from "../modules/google/projections.ts";
import { DATA_PERMISSIONS, EXCHANGE_ROLES } from "../modules/microsoft/projections.ts";

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const slug = (h: string): string => h.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
const headings = (md: string): string[] => md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));

for (const provider of ["google", "microsoft"] as CompanyProvider[]) {
  const page = DOC_PAGE[provider];
  const doc = read(`docs/${page}.md`);

  test(`${provider}: every step has its section, under the step's own title, in the flow's order`, () => {
    const inDoc = headings(doc);
    const steps = FLOW_STEPS[provider];
    assert.deepEqual(inDoc.slice(0, steps.length), steps.map((s) => s.title));
    for (const s of steps) {
      assert.equal(slug(s.title), s.doc, s.title);
      assert.ok((docSection(doc, s.doc) ?? "").length > 80, `${s.title} has words`);
    }
  });

  test(`${provider}: the copy that ships with the Space is the doc`, () => assert.equal(read(`modules/members/guides/${page}.md`), doc));

  test(`${provider}: the guide has no em dash and no section sign`, () => { assert.ok(!doc.includes("—")); assert.ok(!doc.includes("§")); });
}

test("Google: the page lists exactly the scopes Vyre asks for", () => {
  const doc = read("docs/connect-google-workspace.md");
  for (const s of [...DATA_SCOPES.mail, ...DATA_SCOPES.calendar, ...DATA_SCOPES.files, DIRECTORY_SCOPE]) assert.ok(doc.includes(`\`${s}\``), s);
});

test("Microsoft: the page lists exactly what Vyre asks for, and Mail and Calendars are not in the Entra column", () => {
  const doc = read("docs/connect-microsoft-365.md");
  for (const p of [...DATA_PERMISSIONS.calendar, ...DATA_PERMISSIONS.files, "User.Read.All"]) assert.ok(doc.includes(`\`${p}\``), p);
  for (const r of [...EXCHANGE_ROLES.mail, ...EXCHANGE_ROLES.calendar]) assert.ok(doc.includes(`\`${r}\``), r);
  assert.ok(!/^\| Mail \| `/m.test(doc), "the Mail row grants nothing in Entra");
});

test("a table in the guide reads as lines in the app", () => {
  const out = docSection("## One\n\n| a | b |\n|---|---|\n| c | d |\n\n## Two\nno", "one");
  assert.equal(out, "- a: b\n- c: d");
  assert.equal(docSection("## One\ntext", "nothing"), null);
});
