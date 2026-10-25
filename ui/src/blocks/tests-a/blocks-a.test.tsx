// Native chat blocks, part 1: the block registry test. Each of the seven types renders, its buttons and tab match the manifest
// (generated/registry.json), and every action calls the declared capability with the ids from the block data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BLOCK_COMPONENTS_A,
  BLOCK_SPECS_A,
  BlockViewA,
  IDEMPOTENT_CAPS,
  PART_ONE_TYPES,
  actionSpec,
  answerLine,
  buildAnswer,
  canAnswer,
  changesetOpen,
  deployActions,
  extraFor,
  lagLine,
  openTab,
  perform,
  planEdits,
  readPointer,
  resolveInput,
  safeUrl,
  starTerminal,
  tailLines,
  terminalActions,
  togglePick,
  visibleFields,
} from "../impl-a/index.tsx";
import type { BlockHost, PartOneType } from "../impl-a/index.tsx";
import { changesetData, deployData, planData, questionData, terminalData } from "../impl-a/data.ts";
import {
  SAMPLE_CHANGESET,
  SAMPLE_DEPLOY,
  SAMPLE_MOUNT,
  SAMPLE_PLAN,
  SAMPLE_QUESTION,
  SAMPLE_RECORD,
  SAMPLE_TERMINAL,
  sampleBlocksA,
} from "../impl-a/sample.ts";
import type { Block } from "../../kit/types.ts";

interface RegistryBlock {
  type: string;
  component: string;
  actions?: { key: string; cap: string; input: Record<string, string>; label: string }[];
  opens?: { tab: string; input: Record<string, string> };
}
interface RegistryCap {
  name?: string;
  id?: string;
  input: { $ref?: string; properties?: Record<string, unknown>; required?: string[] };
}
interface Registry {
  $defs: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  blocks: RegistryBlock[];
  capabilities: RegistryCap[];
}

const registry = JSON.parse(readFileSync(new URL("../../../../generated/registry.json", import.meta.url), "utf8")) as Registry;

function inputSchema(cap: string): { properties: Record<string, unknown>; required: string[] } {
  const found = registry.capabilities.find((c) => (c.name ?? c.id) === cap);
  assert.ok(found, `capability ${cap} exists in the registry`);
  const raw = found.input;
  const resolved = raw.$ref !== undefined ? registry.$defs[raw.$ref.split("/").pop() ?? ""] : raw;
  assert.ok(resolved, `input of ${cap} resolves`);
  return { properties: resolved.properties ?? {}, required: resolved.required ?? [] };
}

interface Call {
  kind: "invoke" | "open" | "url";
  name: string;
  input: Record<string, unknown>;
}

function fakeHost(): { host: BlockHost; calls: Call[] } {
  const calls: Call[] = [];
  const host: BlockHost = {
    invoke: (capability, input) => {
      calls.push({ kind: "invoke", name: capability, input });
      return undefined;
    },
    open: (tab, input) => {
      calls.push({ kind: "open", name: tab, input });
    },
    openUrl: (url) => {
      calls.push({ kind: "url", name: url, input: {} });
    },
  };
  return { host, calls };
}

const SAMPLES: Record<PartOneType, Block> = {
  terminal: SAMPLE_TERMINAL,
  changeset: SAMPLE_CHANGESET,
  question: SAMPLE_QUESTION,
  plan: SAMPLE_PLAN,
  deploy: SAMPLE_DEPLOY,
  mount: SAMPLE_MOUNT,
  record_card: SAMPLE_RECORD,
};

function html(block: Block, host: BlockHost = fakeHost().host): string {
  return renderToStaticMarkup(<BlockViewA block={block} host={host} />);
}

/* ---------- the table matches the manifests ---------- */

for (const type of PART_ONE_TYPES) {
  test(`${type}: actions, tab and component match the manifest block definition`, () => {
    const def = registry.blocks.find((b) => b.type === type);
    assert.ok(def, `block ${type} is declared`);
    const spec = BLOCK_SPECS_A[type];
    assert.deepEqual(
      spec.actions.map((a) => ({ key: a.key, cap: a.cap, input: a.input })),
      (def.actions ?? []).map((a) => ({ key: a.key, cap: a.cap, input: a.input })),
    );
    assert.deepEqual(spec.opens === undefined ? undefined : { tab: spec.opens.tab, input: spec.opens.input }, def.opens);
    assert.equal(def.component, `ui:Block${type === "record_card" ? "RecordCard" : type.charAt(0).toUpperCase() + type.slice(1)}`);
  });
}

test("the capabilities a block calls need an idempotency key exactly where the manifest says so", () => {
  const caps = new Set<string>();
  for (const type of PART_ONE_TYPES) for (const a of BLOCK_SPECS_A[type].actions) caps.add(a.cap);
  caps.add("stars.toggle");
  for (const cap of caps) {
    const schema = inputSchema(cap);
    const needs = schema.required.includes("idempotencyKey");
    assert.equal(IDEMPOTENT_CAPS.has(cap), needs, `${cap}: idempotencyKey required is ${needs}`);
  }
});

test("every id a block action sends is a field of the block's data schema", () => {
  for (const type of PART_ONE_TYPES) {
    const def = registry.blocks.find((b) => b.type === type);
    assert.ok(def);
    const data = (def as unknown as { data: { properties: Record<string, unknown> } }).data;
    for (const a of BLOCK_SPECS_A[type].actions) {
      for (const pointer of Object.values(a.input)) assert.ok(pointer.slice(1) in data.properties, `${type}.${a.key} reads ${pointer}`);
      const schema = inputSchema(a.cap);
      for (const key of Object.keys(a.input)) assert.ok(key in schema.properties, `${a.cap} takes ${key}`);
    }
  }
});

/* ---------- each type renders ---------- */

test("the registry of this part holds the seven types and each renders its title and buttons", () => {
  assert.deepEqual(Object.keys(BLOCK_COMPONENTS_A).sort(), [...PART_ONE_TYPES].sort());
  assert.equal(sampleBlocksA().length, 7);
  for (const type of PART_ONE_TYPES) {
    const block = SAMPLES[type];
    const markup = html(block);
    assert.ok(markup.includes(`data-block-type="${type}"`), `${type} carries its type`);
    assert.ok(markup.includes(`data-trace-id="${block.traceId}"`), `${type} carries the trace id`);
  }
});

test("a type of another part renders nothing here", () => {
  assert.equal(renderToStaticMarkup(<BlockViewA block={{ type: "diff", v: 1, id: "x", data: {}, traceId: "t" }} host={fakeHost().host} />), "");
});

test("terminal: title, host line, commands, output tail, open and star buttons", () => {
  const markup = html(SAMPLE_TERMINAL);
  assert.ok(markup.includes("Checked the form fields"));
  assert.ok(markup.includes("Ran 2 commands on Intake computer"));
  assert.ok(markup.includes("$ vyre records get rivera --fields intake"));
  assert.ok(markup.includes("missing: id_scan, date_of_birth"));
  assert.ok(markup.includes("Open as tab"));
  assert.ok(markup.includes("Star"));
  assert.ok(markup.includes(">ok<"), "exit shows ok");
  assert.ok(!markup.includes("Interrupt"), "an idle terminal has no Interrupt");
  assert.ok(markup.includes("blk-terminal-blk_term1-close"));
});

test("terminal: a running one offers Interrupt and not Close", () => {
  const running: Block = { ...SAMPLE_TERMINAL, data: { ...(SAMPLE_TERMINAL.data as object), state: "running", exitCode: null } };
  const markup = html(running);
  assert.ok(markup.includes("blk-terminal-blk_term1-interrupt"));
  assert.ok(!markup.includes("blk-terminal-blk_term1-close"));
  assert.ok(markup.includes("Running"));
  assert.deepEqual(terminalActions("running"), { interrupt: true, close: false });
  assert.deepEqual(terminalActions("exited"), { interrupt: false, close: true });
});

test("changeset: counts, review button and the three review actions while open", () => {
  const markup = html(SAMPLE_CHANGESET);
  assert.ok(markup.includes("Changed 3 files in Projects/Rivera matter"));
  assert.ok(markup.includes("+29"));
  assert.ok(markup.includes("−5"));
  for (const key of ["review", "approve", "request_changes", "discard"]) assert.ok(markup.includes(`blk-changeset-blk_chg1-${key}`), key);
});

test("changeset: a committed one keeps Review but loses the review actions", () => {
  const committed: Block = { ...SAMPLE_CHANGESET, data: { ...(SAMPLE_CHANGESET.data as object), state: "committed" } };
  const markup = html(committed);
  assert.ok(markup.includes("blk-changeset-blk_chg1-review"));
  assert.ok(!markup.includes("blk-changeset-blk_chg1-approve"));
  assert.ok(markup.includes("Committed"));
  assert.equal(changesetOpen("committed"), false);
  assert.equal(changesetOpen("open"), true);
  assert.equal(changesetOpen("changes_requested"), true);
});

test("question: single choice shows each option; an answered one shows the answer and no options", () => {
  const markup = html(SAMPLE_QUESTION);
  assert.ok(markup.includes("Which consult length should the form offer?"));
  for (const label of ["30 minutes", "45 minutes", "60 minutes", "Matches the engagement letter"]) assert.ok(markup.includes(label), label);
  assert.ok(markup.includes("Or write your own answer"));
  const answered: Block = { ...SAMPLE_QUESTION, data: { ...(SAMPLE_QUESTION.data as object), answer: { keys: ["45"] }, answeredBy: "Maya" } };
  const done = html(answered);
  assert.ok(done.includes("Maya answered: 45 minutes"));
  assert.ok(!done.includes("Or write your own answer"));
  assert.ok(!done.includes("blk-question-blk_q1-opt-30"));
});

test("question: free mode has a text box and no options; multi mode has an Answer button", () => {
  const free: Block = { ...SAMPLE_QUESTION, data: { ...(SAMPLE_QUESTION.data as object), mode: "free", options: [], allowOther: false } };
  const freeMarkup = html(free);
  assert.ok(freeMarkup.includes("Write your answer"));
  assert.ok(!freeMarkup.includes("blk-question-blk_q1-opt-"));
  const multi: Block = { ...SAMPLE_QUESTION, data: { ...(SAMPLE_QUESTION.data as object), mode: "multi", allowOther: false } };
  const multiMarkup = html(multi);
  assert.ok(multiMarkup.includes("blk-question-blk_q1-answer"));
  assert.ok(multiMarkup.includes("blk-question-blk_q1-opt-60"));
});

test("plan: a proposed plan shows Plan mode on, numbered steps and Approve, Edit, Reject", () => {
  const markup = html(SAMPLE_PLAN);
  assert.ok(markup.includes("Prepare the Rivera intake · 4 steps"));
  assert.ok(markup.includes("Plan mode on"));
  assert.ok(markup.includes("Mount the Marketing folder from Google Drive for the welcome kit"));
  for (const key of ["approve", "edit", "reject"]) assert.ok(markup.includes(`blk-plan-blk_plan1-${key}`), key);
});

test("plan: an approved plan shows progress, a rejected one says so, neither has the buttons", () => {
  const steps = [
    { stepId: "stp_a1", text: "One", state: "done" },
    { stepId: "stp_a2", text: "Two", state: "doing" },
  ];
  const approved = html({ ...SAMPLE_PLAN, data: { ...(SAMPLE_PLAN.data as object), state: "approved", steps } });
  assert.ok(approved.includes("Approved · plan mode is off · 1 of 2 done"));
  assert.ok(!approved.includes("blk-plan-blk_plan1-approve"));
  const rejected = html({ ...SAMPLE_PLAN, data: { ...(SAMPLE_PLAN.data as object), state: "rejected" } });
  assert.ok(rejected.includes("Rejected"));
});

test("deploy: a ready preview shows its link, checks and Promote; production offers Roll back instead", () => {
  const markup = html(SAMPLE_DEPLOY);
  assert.ok(markup.includes("Deploy preview is live"));
  assert.ok(markup.includes("booking-rivera.preview.vyre.run"));
  assert.ok(markup.includes("3 checks passed"));
  assert.ok(markup.includes("blk-deploy-blk_dep1-promote"));
  assert.ok(!markup.includes("blk-deploy-blk_dep1-rollback"));
  const prod: Block = { ...SAMPLE_DEPLOY, data: { ...(SAMPLE_DEPLOY.data as object), env: "production" } };
  const prodMarkup = html(prod);
  assert.ok(prodMarkup.includes("blk-deploy-blk_dep1-rollback"));
  assert.ok(!prodMarkup.includes("blk-deploy-blk_dep1-promote"));
});

test("deploy: a failed build names the failing check and has no link when there is no address", () => {
  const failed: Block = {
    ...SAMPLE_DEPLOY,
    data: { ...(SAMPLE_DEPLOY.data as object), state: "failed", url: "javascript:alert(1)", checks: [{ name: "Build", ok: false }, { name: "Links", ok: true }] },
  };
  const markup = html(failed);
  assert.ok(markup.includes("Deploy preview failed"));
  assert.ok(markup.includes("Build failed"));
  assert.ok(markup.includes("1 of 2 checks failed"));
  assert.ok(!markup.includes("blk-deploy-blk_dep1-link"), "a javascript: address is never a link");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl(" https://a.example "), "https://a.example");
});

test("mount: title, provider, sync lag, Open in Files and Sync now", () => {
  const markup = html(SAMPLE_MOUNT);
  assert.ok(markup.includes("Mounted Marketing from Google Drive"));
  assert.ok(markup.includes("2 min behind"));
  assert.ok(markup.includes("Open in Files"));
  assert.ok(markup.includes("blk-mount-blk_mnt1-sync"));
  assert.equal(lagLine(2), "In sync");
  assert.equal(lagLine(30), "30 s behind");
});

test("record card: title, type, status, summary and up to four readable fields", () => {
  const markup = html(SAMPLE_RECORD);
  assert.ok(markup.includes("Elena Rivera"));
  assert.ok(markup.includes("contact"));
  assert.ok(markup.includes("Consult booked"));
  assert.ok(markup.includes("Referred by Maya Chen"));
  assert.ok(markup.includes("elena@rivera.example"));
  assert.ok(markup.includes("Maya Chen, Omar Haddad"), "a list value is joined");
  assert.ok(!markup.includes("Sealed"), "an object value (sealed) is left out");
  const fields = (SAMPLE_RECORD.data as { fields: { key: string; title: string; value: unknown }[] }).fields;
  assert.equal(visibleFields(fields).length, 4);
});

test("a thin payload never throws: every card renders from empty data", () => {
  for (const type of PART_ONE_TYPES) assert.doesNotThrow(() => html({ type, v: 1, id: "blk_empty", data: {}, traceId: "t" }), type);
  for (const type of PART_ONE_TYPES) assert.doesNotThrow(() => html({ type, v: 1, id: "blk_null", data: null, traceId: "t" }), `${type} null`);
});

/* ---------- every action calls the declared capability ---------- */

for (const type of PART_ONE_TYPES) {
  for (const spec of BLOCK_SPECS_A[type].actions) {
    test(`${type}.${spec.key} calls ${spec.cap} with the ids from the block`, async () => {
      const { host, calls } = fakeHost();
      const block = SAMPLES[type];
      const ok = await perform(host, type, spec.key, block, type === "question" ? { answer: { keys: ["45"] } } : {});
      assert.equal(ok, true);
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call);
      assert.equal(call.kind, "invoke");
      assert.equal(call.name, spec.cap);
      for (const [key, pointer] of Object.entries(spec.input)) assert.equal(call.input[key], readPointer(block.data, pointer), `${key} from ${pointer}`);
      const schema = inputSchema(spec.cap);
      for (const key of schema.required) assert.ok(key in call.input, `${spec.cap} receives required ${key}`);
      for (const key of Object.keys(call.input)) assert.ok(key in schema.properties, `${spec.cap} declares ${key}`);
    });
  }
}

test("an unknown action calls nothing", async () => {
  const { host, calls } = fakeHost();
  assert.equal(await perform(host, "terminal", "explode", SAMPLE_TERMINAL), false);
  assert.equal(calls.length, 0);
  assert.equal(actionSpec("terminal", "explode"), undefined);
});

test("each press of an idempotent action gets its own key", () => {
  const a = extraFor("deploy", "promote", SAMPLE_DEPLOY);
  const b = extraFor("deploy", "promote", SAMPLE_DEPLOY);
  assert.equal(typeof a["idempotencyKey"], "string");
  assert.notEqual(a["idempotencyKey"], b["idempotencyKey"]);
  assert.deepEqual(extraFor("terminal", "interrupt", SAMPLE_TERMINAL), {});
});

/* ---------- opening a tab ---------- */

test("each block with a tab opens the tab the manifest names, with its ids", () => {
  for (const type of PART_ONE_TYPES) {
    const spec = BLOCK_SPECS_A[type];
    const { host, calls } = fakeHost();
    const opened = openTab(host, type, SAMPLES[type].data);
    if (spec.opens === undefined) {
      assert.equal(opened, false);
      continue;
    }
    assert.equal(opened, true, `${type} opens`);
    assert.equal(calls[0]?.kind, "open");
    assert.equal(calls[0]?.name, spec.opens.tab);
    assert.deepEqual(calls[0]?.input, resolveInput(SAMPLES[type].data, spec.opens.input));
  }
});

test("a tab is not opened when the block lacks the id it needs", () => {
  const { host, calls } = fakeHost();
  assert.equal(openTab(host, "changeset", {}), false);
  assert.equal(calls.length, 0);
});

test("starring a terminal goes through stars.toggle with the terminal resource", async () => {
  const { host, calls } = fakeHost();
  await starTerminal(host, "trm_a1b2c3", true);
  assert.deepEqual(calls[0], { kind: "invoke", name: "stars.toggle", input: { resource: { type: "terminal", id: "trm_a1b2c3" }, on: true } });
  const schema = inputSchema("stars.toggle");
  for (const key of Object.keys(calls[0]?.input ?? {})) assert.ok(key in schema.properties);
});

/* ---------- the small decisions ---------- */

test("question answers: single picks replace, multi picks toggle, free is text only", () => {
  assert.deepEqual(togglePick("single", ["a"], "b"), ["b"]);
  assert.deepEqual(togglePick("multi", ["a"], "b"), ["a", "b"]);
  assert.deepEqual(togglePick("multi", ["a", "b"], "a"), ["b"]);
  assert.deepEqual(buildAnswer("single", ["a", "b"], ""), { keys: ["a"] });
  assert.deepEqual(buildAnswer("multi", ["a", "b"], " other "), { keys: ["a", "b"], text: "other" });
  assert.deepEqual(buildAnswer("free", ["a"], " hello "), { keys: [], text: "hello" });
  assert.equal(canAnswer("free", [], "  "), false);
  assert.equal(canAnswer("multi", [], ""), false);
  assert.equal(canAnswer("multi", ["a"], ""), true);
  assert.equal(answerLine([{ key: "a", label: "Alpha" }], { keys: ["a"], text: "more" }), "Alpha, more");
});

test("plan edits send only changed or removed steps", () => {
  const steps = planData(SAMPLE_PLAN.data).steps;
  const edits = planEdits(steps, { stp_a1: "Mount Marketing read-only", stp_a2: steps[1]?.text ?? "", stp_a3: "   " }, new Set(["stp_a4"]));
  assert.deepEqual(edits, [{ stepId: "stp_a1", text: "Mount Marketing read-only" }, { stepId: "stp_a4", remove: true }]);
});

test("approving a plan with edits sends them to chat.approve_plan; without edits it sends none", async () => {
  const { host, calls } = fakeHost();
  const steps = planData(SAMPLE_PLAN.data).steps;
  const edits = planEdits(steps, { stp_a1: "Changed" }, new Set());
  await perform(host, "plan", "approve", SAMPLE_PLAN, edits.length > 0 ? { edits } : {});
  await perform(host, "plan", "approve", SAMPLE_PLAN, {});
  assert.deepEqual(calls[0]?.input, { threadId: "thr_a1b2c3", planId: "pln_a1b2c3", edits: [{ stepId: "stp_a1", text: "Changed" }] });
  assert.deepEqual(calls[1]?.input, { threadId: "thr_a1b2c3", planId: "pln_a1b2c3" });
});

test("data readers fall back to safe values", () => {
  assert.equal(terminalData(undefined).state, "idle");
  assert.equal(changesetData({}).folderName, "this folder");
  assert.equal(questionData({ mode: "weird" }).mode, "single");
  assert.equal(deployData({ state: "weird" }).state, "queued");
  assert.deepEqual(deployActions("ready", true, "preview"), { promote: true, rollback: false });
  assert.deepEqual(deployActions("ready", true, "production"), { promote: false, rollback: true });
  assert.deepEqual(tailLines("a\nb\nc\nd\ne\nf\ng\nh\n", 3), ["f", "g", "h"]);
});
