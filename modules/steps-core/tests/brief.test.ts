// The brief of an AI step (work baton, item 8): fixed sections in a fixed order, only the sections that have something to say, the deliverable as a field list with an example, the baton tools for an
// agent task only, and nothing a Vault could hold. These tests check sections and rules, not a stored copy of the text.
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrief, fieldLines, linkedIn, scrub } from "../handlers/brief.ts";
import type { BriefInput } from "../handlers/brief.ts";

const titles = (b: string): string[] => [...b.matchAll(/^## (.+)$/gm)].map((m) => m[1]!);
const schema = {
  type: "object", required: ["letter", "tone"],
  properties: { letter: { type: "string", description: "The finished letter" }, tone: { type: "string", enum: ["formal", "warm"] }, score: { type: "integer", minimum: 0, maximum: 10 }, client: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
};
const full = (over: Partial<BriefInput> = {}): BriefInput => ({
  kind: "task", goal: "Draft the engagement letter for Dana Ortiz.", automation: "New client welcome", trigger: { name: "Dana Ortiz", matter: "rec_m1" },
  outputs: { find: { rows: [{ id: "rec_c1", fields: { name: "Dana Ortiz" } }] }, files: { id: "fil_nda", name: "nda.pdf" } }, inputs: { template: "Standard letter", fee: 1500 },
  schema, doneMeans: ["Names the client", "States the fee"], reviewer: "Checker", approver: "Olivia", timeoutMinutes: 20, ...over,
});

test("an agent task brief has every section, in order", () => {
  const b = buildBrief(full());
  assert.deepEqual(titles(b), ["Goal", "Context", "Inputs", "Deliverable", "Done means", "Next", "Rules", "Finish"]);
  assert.match(b, /^## Goal\nDraft the engagement letter for Dana Ortiz\./);
  assert.match(b, /Automation: New client welcome/);
  assert.match(b, /Started by: \{"name":"Dana Ortiz","matter":"rec_m1"\}/);
  assert.match(b, /Records: Dana Ortiz \(rec_c1\)/, "a linked record by its title and id");
  assert.match(b, /Files: nda\.pdf \(fil_nda\)/, "a file by its name and id");
  assert.match(b, /- find: \{"rows":/, "an earlier step by its name");
  assert.match(b, /## Inputs\ntemplate: Standard letter\nfee: 1500/);
  assert.match(b, /Done means\n- Names the client\n- States the fee/);
  assert.match(b, /Checker reviews your work against Done means\./);
  assert.match(b, /Olivia approves it before anything is final\./);
  assert.match(b, /Take at most 20 minutes\./);
  assert.match(b, /held for approval/);
  assert.match(b, /task_submit[^\n]*task_ask[^\n]*task_block/);
});

test("an answer brief has no Finish and no baton tools, and carries the schema its answer is checked against", () => {
  const b = buildBrief(full({ kind: "answer", reviewer: undefined, approver: undefined, doneMeans: undefined }));
  assert.deepEqual(titles(b), ["Goal", "Context", "Inputs", "Deliverable", "Rules"]);
  assert.doesNotMatch(b, /task_submit|Finish|baton/);
  assert.match(b, /Answer with one JSON value only, no other text, that matches this JSON Schema:\n\{"type":"object"/);
  assert.doesNotMatch(b, /leaves Vyre/, "an answer has no tools, so nothing in it can leave");
});

test("a section with nothing to say is left out", () => {
  const b = buildBrief({ kind: "answer", goal: "Say hello." });
  assert.deepEqual(titles(b), ["Goal", "Rules"]);
  assert.equal(buildBrief({ kind: "answer", goal: "Say hello.", trigger: {}, outputs: {}, inputs: undefined }).includes("Context"), false);
});

test("the deliverable lists each field with whether it is required, its type and meaning, and a tiny example", () => {
  const lines = fieldLines(schema);
  assert.deepEqual(lines, [
    "- letter (required, string): The finished letter",
    '- tone (required, string, one of "formal", "warm")',
    "- score (optional, integer, 0 to 10)",
    "- client (optional, object)",
    "- client.name (required, string)",
  ]);
  const b = buildBrief(full());
  assert.match(b, /Example: \{/);
  const example = JSON.parse(/Example: (\{.*\})/.exec(b)![1]!) as Record<string, unknown>;
  assert.equal(typeof example.letter, "string");
  assert.doesNotMatch(b.slice(b.indexOf("## Deliverable"), b.indexOf("## Done means")), /"required":\[/, "an agent task shows fields, not the raw schema");
});

test("no Vault value can appear: secret-looking data is hidden, handles stay, and no key or account is read", () => {
  const b = buildBrief(full({
    trigger: { name: "Dana", apiKey: "sk-live-123456", note: "see #Acme_API" },
    outputs: { http: { headers: { Authorization: "Bearer abc.def.ghi" }, token: "t0ps3cret", body: { ok: true } }, auth: { password: "hunter2" } },
    inputs: { password: "hunter2", handle: "#Acme_API", plain: "sk-ant-oat01-TESTsecret" },
  }));
  for (const secret of ["sk-live-123456", "abc.def.ghi", "t0ps3cret", "hunter2", "sk-ant-oat01-TESTsecret"]) assert.ok(!b.includes(secret), `${secret} must not be in the brief`);
  assert.match(b, /\[hidden\]/);
  assert.match(b, /#Acme_API/, "a handle is how a secret is named; it is not a value");
  const input = full() as BriefInput & Record<string, unknown>;
  assert.ok(!("keyId" in input) && !("backupKeyId" in input), "the builder takes no key or account at all");
  assert.equal(scrub({ apiKey: "#Handle" }) && (scrub({ apiKey: "#Handle" }) as { apiKey: string }).apiKey, "#Handle");
});

test("earlier outputs are cut so a long Run does not swamp the brief", () => {
  const outputs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, { rows: Array.from({ length: 200 }, (_, j) => ({ n: j })) }]));
  const b = buildBrief(full({ outputs }));
  assert.ok(b.length < 20_000, `${b.length}`);
  assert.match(b, /more steps ran before/);
  assert.ok(!b.includes('"n":199'), "each output is cut");
});

test("a huge input is refused by name", () => {
  assert.throws(() => buildBrief({ kind: "answer", goal: "x", inputs: { text: "a".repeat(100_001) } }), RangeError);
});

test("linkedIn finds records and files wherever the data carries them", () => {
  const l = linkedIn({ a: [{ id: "rec_1", title: "Smith matter" }] }, { b: { fileId: "fil_2", fileName: "id.png" } }, { id: "rec_1", name: "again" }, { id: "usr_3" });
  assert.deepEqual(l, { records: [{ id: "rec_1", title: "Smith matter" }], files: [{ id: "fil_2", name: "id.png" }] });
});

test("no em dash, no section sign", () => {
  assert.doesNotMatch(buildBrief(full()), /[—§]/u);
});
