// The server side of the native block contract (ARCH 6.8): every block type of the frozen contract has an emitter and a fallback that works without a renderer, the data is checked before a block
// exists, streaming blocks take frames, and the Vault's blocks never hold a value.
// Path mapping: the packet owns agent/tests/skill-evals/** and names this file at agent/tests/blocks.registry.test.ts in its checklist; it sits where the checklist puts it.
import test from "node:test";
import assert from "node:assert/strict";
import { sample } from "../../packages/contracts/src/jsonschema.ts";
import { blockHelpers, createBlocks, fallbackText, fillTemplate, genericLine, loadBlockRegistry, STREAMING_TYPES } from "../src/blocks/index.ts";
import type { Block } from "../src/blocks/index.ts";
import { createScrubber } from "../src/vault-use/index.ts";

const reg = loadBlockRegistry();
const TRACE = "0123456789abcdef0123456789abcdef";
const NATIVE_14 = ["terminal", "changeset", "question", "plan", "deploy", "mount", "record_card", "diff", "file", "screenshot", "tab_opened", "memory_saved", "vault_used", "model_switch"];
const NAMED_7 = ["memory_saved", "vault_used", "access_request", "secret_input", "model_switch", "helper", "diff_card"];
const make = (over: Partial<Parameters<typeof createBlocks>[0]> = {}) => createBlocks({ defs: reg.defs, schemas: reg.schemas, ...over });
const defsByKey = new Map(reg.defs.map((d) => [`${d.type}@${d.v}`, d]));
const fail = (f: () => unknown): { code: string; details?: Record<string, unknown> } => {
  try { f(); } catch (e) { const err = (e as { error: { code: string; details?: Record<string, unknown> } }).error; return { code: err.code, ...(err.details ? { details: err.details } : {}) }; }
  return { code: "none" };
};

test("every block type of the contract has an emitter, and the fourteen native ones and the seven named ones are among them", () => {
  const b = make();
  assert.equal(reg.defs.length, 22);
  assert.deepEqual(b.types(), [...new Set(reg.defs.map((d) => d.type))].sort());
  for (const t of [...NATIVE_14, ...NAMED_7]) assert.ok(b.has(t), t);
  assert.equal(b.has("nope"), false);
  assert.equal(b.has("terminal", 1), true);
  assert.equal(b.has("terminal", 2), false);
});

test("every block type emits a valid block from a sample of its own schema, with an id, a trace id, a state and a fallback line", () => {
  const b = make({ newId: (() => { let n = 0; return () => `blk_t${++n}`; })() });
  for (const def of reg.defs) {
    const data = sample(def.data, 0, reg.schemas);
    const block = b.emit(def.type, data, { traceId: TRACE });
    assert.equal(block.type, def.type);
    assert.equal(block.v, def.v);
    assert.match(block.id, /^blk_[a-z0-9]+$/);
    assert.equal(block.traceId, TRACE);
    assert.ok(["live", "done", "waiting"].includes(block.state ?? ""), def.type);
    assert.ok(b.text(block).length > 0, `${def.type} has a fallback line`);
    assert.equal(b.text(block).includes("{{"), false, `${def.type}: no slot is left unfilled`);
  }
});

test("a block whose data breaks its type is refused with the paths that broke it; nothing is made", () => {
  const b = make();
  const r = fail(() => b.emit("memory_saved", { factId: "fct_1", layer: "nowhere", text: "x", canPromote: true }, { traceId: TRACE }));
  assert.equal(r.code, "validation.bad_input");
  assert.ok(JSON.stringify(r.details).includes("layer"));
  assert.equal(fail(() => b.emit("memory_saved", {}, { traceId: TRACE })).code, "validation.bad_input");
  assert.equal(fail(() => b.emit("no_such_block", {}, { traceId: TRACE })).code, "validation.bad_input");
  assert.equal(fail(() => b.emit("memory_saved", sample(defsByKey.get("memory_saved@1")!.data, 0, reg.schemas), { traceId: TRACE, v: 2 })).code, "validation.bad_input", "a version the contract does not have");
});

test("blocks that wait for an answer are waiting, streaming blocks are live, the rest are done; a caller may name the state", () => {
  const b = make();
  const state = (t: string, o: { state?: Block["state"] } = {}) => b.emit(t, sample(defsByKey.get(`${t}@1`)!.data, 0, reg.schemas), { traceId: TRACE, ...o }).state;
  for (const d of reg.defs) {
    const want = d.waitsForAnswer ? "waiting" : STREAMING_TYPES.has(d.type) ? "live" : "done";
    assert.equal(state(d.type), want, d.type);
  }
  assert.deepEqual([...STREAMING_TYPES].sort(), ["deploy", "screenshot", "terminal"]);
  assert.equal(state("question"), "waiting");
  assert.equal(state("terminal", { state: "done" }), "done");
  assert.equal(b.emit("file", sample(defsByKey.get("file@1")!.data, 0, reg.schemas), { traceId: TRACE, id: "blk_mine" }).id, "blk_mine", "a device keeps its own id");
});

test("fallback text: slots, dotted paths and lengths fill; a type nobody knows, or a newer version of one that is known, gets the generic line with the trace id", () => {
  assert.equal(fillTemplate("Using {{to.model}} for this step", { to: { model: "claude-sonnet-5-5" } }), "Using claude-sonnet-5-5 for this step");
  assert.equal(fillTemplate("Plan: {{title}} ({{steps.length}} steps)", { title: "Reorganise", steps: [1, 2, 3] }), "Plan: Reorganise (3 steps)");
  assert.equal(fillTemplate("Access request: {{requester}} asks for {{level}}. {{note}}", { requester: "usr_a", level: "edit" }), "Access request: usr_a asks for edit.");
  assert.equal(fillTemplate("{{a.b.c}} / {{missing}} / {{n}}", { a: { b: "x" }, n: 7 }), "/ / 7");
  const defs = defsByKey;
  const known: Block = { type: "file", v: 1, id: "blk_1", data: { name: "client-intake.pdf" }, traceId: TRACE };
  assert.equal(fallbackText(known, defs), "File client-intake.pdf");
  const unknown: Block = { type: "hologram", v: 1, id: "blk_2", data: {}, traceId: TRACE };
  assert.equal(fallbackText(unknown, defs), `hologram block (v1), trace ${TRACE}`);
  assert.equal(fallbackText({ ...known, v: 9 }, defs), genericLine({ type: "file", v: 9, traceId: TRACE }));
  assert.ok(genericLine(unknown).includes(TRACE), "the line can always be quoted");
});

test("streaming blocks take frames: text is appended, fields are set, the result is checked again, and other blocks do not stream", () => {
  const b = make();
  const term = b.emit("terminal", { terminalId: "trm_1", title: "Build", host: "agent_computer", hostTitle: "Intake computer", commands: [{ command: "npm test", exitCode: null, startedAt: 1760000000000 }], tail: "", state: "running", exitCode: null }, { traceId: TRACE });
  const one = b.patch(term, [{ op: "append", path: "/tail", value: "ok 1\n" }, { op: "append", path: "/tail", value: "ok 2\n" }]);
  assert.equal((one.block.data as { tail: string }).tail, "ok 1\nok 2\n");
  assert.deepEqual(one.frame, { id: term.id, ops: [{ op: "append", path: "/tail", value: "ok 1\n" }, { op: "append", path: "/tail", value: "ok 2\n" }] });
  assert.equal((term.data as { tail: string }).tail, "", "the block it started from is not changed");
  const done = b.patch(one.block, [{ op: "set", path: "/state", value: "exited" }, { op: "set", path: "/exitCode", value: 0 }]);
  assert.deepEqual([(done.block.data as { state: string }).state, (done.block.data as { exitCode: number }).exitCode], ["exited", 0]);
  assert.equal(fail(() => b.patch(one.block, [{ op: "set", path: "/state", value: "exploded" }])).code, "validation.bad_input", "a frame cannot break the type");
  assert.equal(fail(() => b.patch(one.block, [{ op: "append", path: "/exitCode", value: "x" }])).code, "validation.bad_input");
  assert.equal(fail(() => b.patch(one.block, [{ op: "set", path: "/commands/0", value: 1 }])).code, "validation.bad_input", "one top-level field per frame");
  const file = b.emit("file", sample(defsByKey.get("file@1")!.data, 0, reg.schemas), { traceId: TRACE });
  assert.equal(fail(() => b.patch(file, [{ op: "set", path: "/name", value: "x" }])).code, "validation.bad_input");
});

test("a Vault value never reaches a block: the scrubber runs over every string of the data, and the Vault's own blocks refuse a value field", () => {
  const scrubber = createScrubber([{ handle: "#Dana_Lawmatics.api_key", itemId: "vit_1", value: "zq7-fake-secret-0042-value" }]);
  const b = make({ scrub: (t) => scrubber.scrub(t) });
  const card = b.emit("memory_saved", { factId: "fct_1", layer: "person", text: "The key is zq7-fake-secret-0042-value", canPromote: true }, { traceId: TRACE });
  assert.equal(JSON.stringify(card).includes("zq7-fake-secret-0042-value"), false);
  const term = b.emit("terminal", { terminalId: "trm_1", title: "t", host: "device", hostTitle: "Mac", commands: [], tail: "", state: "running", exitCode: null }, { traceId: TRACE });
  const patched = b.patch(term, [{ op: "append", path: "/tail", value: "echo zq7-fake-secret-0042-value" }]);
  assert.equal(JSON.stringify(patched.block).includes("zq7-fake-secret-0042-value"), false, "a frame is scrubbed too");

  const plain = make();
  assert.equal(fail(() => plain.emit("secret_input", { name: "Dana_Lawmatics", kind: "api_key", folderId: "vfd_1", fields: ["api_key"], value: "hunter2" }, { traceId: TRACE })).code, "validation.bad_input");
  assert.equal(fail(() => plain.emit("vault_used", { itemId: "vit_1", name: "Dana_Lawmatics", handle: "#Dana_Lawmatics", fields: ["api_key"], outcome: "used", secret: "hunter2" }, { traceId: TRACE })).code, "validation.bad_input");
  assert.equal(fail(() => plain.emit("vault_used", { itemId: "vit_1", name: "Dana_Lawmatics", handle: "not-a-handle", fields: ["api_key"], outcome: "used" }, { traceId: TRACE })).code, "validation.bad_input", "only a handle");
  // field NAMES that sound like secrets are fine: they are names
  const ok = plain.emit("vault_used", { itemId: "vit_1", name: "Dana_Lawmatics", handle: "#Dana_Lawmatics", fields: ["api_key", "password"], outcome: "filled" }, { traceId: TRACE });
  assert.deepEqual((ok.data as { fields: string[] }).fields, ["api_key", "password"]);
});

test("redaction runs before the block exists: a sealed value in the data becomes a mask", () => {
  const b = make({ redact: (def, data) => (def.type === "diff_card" ? JSON.parse(JSON.stringify(data).replaceAll("sk-live-xyz", "[sealed]")) : data) });
  const card = blockHelpers(b).diffCard({ diffId: "dif_1", kind: "connector", title: "Change the API key", changes: [{ path: "/apiKey", before: "sk-live-xyz", after: "sk-live-xyz" }] }, { traceId: TRACE });
  assert.equal(JSON.stringify(card).includes("sk-live-xyz"), false);
  assert.ok(JSON.stringify(card).includes("[sealed]"));
});

test("the named blocks: what follows from the facts is filled in, and each goes through the one emitter", () => {
  const b = make();
  const h = blockHelpers(b);
  const o = { traceId: TRACE };
  const person = h.memorySaved({ factId: "fct_1", layer: "person", text: "Likes three bullets." }, o);
  assert.deepEqual([person.type, (person.data as { canPromote: boolean }).canPromote], ["memory_saved", true]);
  assert.equal((h.memorySaved({ factId: "fct_2", layer: "space", text: "Office closes at 5." }, o).data as { canPromote: boolean }).canPromote, false, "already shared");
  assert.equal(b.text(person), "Saved to your person layer: Likes three bullets.");

  const used = h.vaultUsed({ itemId: "vit_1", name: "Dana_Lawmatics", handle: "#Dana_Lawmatics", fields: ["api_key"], outcome: "filled", where: "host" }, o);
  assert.equal(b.text(used), "Used #Dana_Lawmatics (filled). The value was not shown.");

  const req = h.accessRequest({ requestId: "arq_1", requester: "usr_ana", resource: { type: "folder", id: "fld_1" }, resourceTitle: "Clients", level: "edit", note: "For the intake work" }, o);
  assert.equal(req.state, "waiting");
  assert.equal(h.accessRequest({ requestId: "arq_1", requester: "usr_ana", resource: { type: "folder", id: "fld_1" }, resourceTitle: "Clients", level: "edit", state: "granted" }, o).state, "done");

  const sec = h.secretInput({ name: "Dana_Lawmatics", kind: "api_key", folderId: "vfd_1", fields: ["api_key"], hint: "Type it here." }, o);
  assert.match(b.text(sec), /does not enter this chat/);

  const sw = h.modelSwitch({ threadId: "thr_1", agentId: "agt_intake", scope: "sub_task", from: { provider: "anthropic", model: "claude-sonnet-5-5" }, to: { provider: "openai", model: "gpt-5" } }, o);
  assert.equal(b.text(sw), "Using gpt-5 for this step");

  const path = [{ title: "Intake chat", threadId: "thr_1" }];
  const run = { threadId: "thr_2", parentThreadId: "thr_1", title: "Check the form", agentId: "agt_helper", path };
  assert.equal(h.helper({ ...run, status: "running" }, o).state, "live");
  assert.equal(h.helper({ ...run, status: "failed" }, o).state, "error");
  assert.equal(h.helper({ ...run, status: "done" }, o).state, "done");

  const diff = h.diffCard({ diffId: "dif_1", kind: "role", title: "Let developers deploy", changes: [{ path: "/perms/deploy", before: false, after: true }], affects: "6 people" }, o);
  assert.equal(b.text(diff), "Proposed change: Let developers deploy");
});
