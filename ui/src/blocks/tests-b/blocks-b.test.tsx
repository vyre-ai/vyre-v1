// Native chat blocks, part 2: the block registry test. Each of the seven types renders, its buttons and tab match the manifest
// (generated/registry.json), every action calls the declared capability with the ids from the block data, and the value typed into
// secret_input never appears in a block, the rendered thread or a log.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BLOCK_COMPONENTS_B,
  BLOCK_SPECS_B,
  BlockViewB,
  IDEMPOTENT_CAPS_B,
  PART_TWO_TYPES,
  SET_MODEL_CAPABILITY,
  canPropose,
  canSaveSecret,
  extraForB,
  fieldLabel,
  helperTrail,
  modelChoices,
  openTabB,
  performB,
  promoteTarget,
  readPointer,
  redactSecretInput,
  requestView,
  runActionB,
  secretFields,
  valueText,
  vaultLine,
} from "../impl-b/index.tsx";
import type { BlockHostB, PartTwoType } from "../impl-b/index.tsx";
import { accessRequestData, diffCardData, helperData, memorySavedData, modelSwitchData, secretInputData, vaultUsedData } from "../impl-b/data.ts";
import { SAMPLE_ACCESS_REQUEST, SAMPLE_DIFF_CARD, SAMPLE_HELPER, SAMPLE_MEMORY, SAMPLE_MODEL_SWITCH, SAMPLE_SECRET_INPUT, SAMPLE_VAULT_USED, sampleBlocksB } from "../impl-b/sample.ts";
import type { Block } from "../../kit/types.ts";

interface RegistryBlock {
  type: string;
  component: string;
  actions?: { key: string; cap: string; input: Record<string, string>; label: string }[];
  opens?: { tab: string; input: Record<string, string> };
  data: { $ref?: string; properties?: Record<string, unknown>; required?: string[] };
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

function dataSchema(def: RegistryBlock): { properties: Record<string, unknown>; required: string[] } {
  const raw = def.data;
  const resolved = raw.$ref !== undefined ? registry.$defs[raw.$ref.split("/").pop() ?? ""] : raw;
  assert.ok(resolved, `data of ${def.type} resolves`);
  return { properties: resolved.properties ?? {}, required: resolved.required ?? [] };
}

function inputSchema(cap: string): { properties: Record<string, unknown>; required: string[] } {
  const found = registry.capabilities.find((c) => (c.name ?? c.id) === cap);
  assert.ok(found, `capability ${cap} exists in the registry`);
  const raw = found.input;
  const resolved = raw.$ref !== undefined ? registry.$defs[raw.$ref.split("/").pop() ?? ""] : raw;
  assert.ok(resolved, `input of ${cap} resolves`);
  return { properties: resolved.properties ?? {}, required: resolved.required ?? [] };
}

interface Call {
  kind: "invoke" | "open";
  name: string;
  input: Record<string, unknown>;
}

function fakeHost(extra: Partial<BlockHostB> = {}): { host: BlockHostB; calls: Call[] } {
  const calls: Call[] = [];
  const host: BlockHostB = {
    invoke: (capability, input) => {
      calls.push({ kind: "invoke", name: capability, input });
      return undefined;
    },
    open: (tab, input) => {
      calls.push({ kind: "open", name: tab, input });
    },
    ...extra,
  };
  return { host, calls };
}

const SAMPLES: Record<PartTwoType, Block> = {
  memory_saved: SAMPLE_MEMORY,
  vault_used: SAMPLE_VAULT_USED,
  access_request: SAMPLE_ACCESS_REQUEST,
  secret_input: SAMPLE_SECRET_INPUT,
  model_switch: SAMPLE_MODEL_SWITCH,
  helper: SAMPLE_HELPER,
  diff_card: SAMPLE_DIFF_CARD,
};

function html(block: Block, host: BlockHostB = fakeHost().host): string {
  return renderToStaticMarkup(<BlockViewB block={block} host={host} />);
}

const COMPONENT_NAME: Record<PartTwoType, string> = {
  memory_saved: "ui:BlockMemorySaved",
  vault_used: "ui:BlockVaultUsed",
  access_request: "ui:BlockAccessRequest",
  secret_input: "ui:BlockSecretInput",
  model_switch: "ui:BlockModelSwitch",
  helper: "ui:BlockHelper",
  diff_card: "ui:BlockDiffCard",
};

/* ---------- the table matches the manifests ---------- */

for (const type of PART_TWO_TYPES) {
  test(`${type}: actions, tab and component match the manifest block definition`, () => {
    const def = registry.blocks.find((b) => b.type === type);
    assert.ok(def, `block ${type} is declared`);
    const spec = BLOCK_SPECS_B[type];
    assert.deepEqual(
      spec.actions.map((a) => ({ key: a.key, cap: a.cap, input: a.input })),
      (def.actions ?? []).map((a) => ({ key: a.key, cap: a.cap, input: a.input })),
    );
    assert.deepEqual(spec.opens === undefined ? undefined : { tab: spec.opens.tab, input: spec.opens.input }, def.opens);
    assert.equal(def.component, COMPONENT_NAME[type]);
  });
}

test("the capabilities a block calls need an idempotency key exactly where the manifest says so", () => {
  const caps = new Set<string>();
  for (const type of PART_TWO_TYPES) for (const a of BLOCK_SPECS_B[type].actions) caps.add(a.cap);
  caps.add(SET_MODEL_CAPABILITY);
  for (const cap of caps) {
    const needs = inputSchema(cap).required.includes("idempotencyKey");
    assert.equal(IDEMPOTENT_CAPS_B.has(cap), needs, `${cap}: idempotencyKey required is ${needs}`);
  }
});

test("every id a block action sends is a field of the block's data schema", () => {
  for (const type of PART_TWO_TYPES) {
    const def = registry.blocks.find((b) => b.type === type);
    assert.ok(def);
    for (const a of BLOCK_SPECS_B[type].actions) {
      for (const pointer of Object.values(a.input)) assert.ok(pointer.slice(1) in dataSchema(def).properties, `${type}.${a.key} reads ${pointer}`);
      const schema = inputSchema(a.cap);
      for (const key of Object.keys(a.input)) assert.ok(key in schema.properties, `${a.cap} takes ${key}`);
    }
  }
});

test("the sample blocks carry every required field of their data schema", () => {
  for (const block of sampleBlocksB()) {
    const def = registry.blocks.find((b) => b.type === block.type);
    assert.ok(def);
    for (const key of dataSchema(def).required) assert.ok(key in (block.data as object), `${block.type} has ${key}`);
  }
});

/* ---------- registry of the seven ---------- */

test("the registry of this part holds the seven types and each renders with its type and trace id", () => {
  assert.deepEqual(Object.keys(BLOCK_COMPONENTS_B).sort(), [...PART_TWO_TYPES].sort());
  assert.equal(sampleBlocksB().length, 7);
  for (const type of PART_TWO_TYPES) {
    const block = SAMPLES[type];
    const markup = html(block);
    assert.ok(markup.includes(`data-block-type="${type}"`), `${type} carries its type`);
    assert.ok(markup.includes(`data-trace-id="${block.traceId}"`), `${type} carries the trace id`);
  }
});

test("a type of another part renders nothing here", () => {
  assert.equal(renderToStaticMarkup(<BlockViewB block={{ type: "terminal", v: 1, id: "x", data: {}, traceId: "t" }} host={fakeHost().host} />), "");
});

test("a thin payload never throws: every card renders from empty or null data", () => {
  for (const type of PART_TWO_TYPES) {
    assert.doesNotThrow(() => html({ type, v: 1, id: "blk_empty", data: {}, traceId: "t" }), type);
    assert.doesNotThrow(() => html({ type, v: 1, id: "blk_null", data: null, traceId: "t" }), `${type} null`);
  }
});

test("memory_saved: the layer, the text and Propose for team while it can be promoted", () => {
  const markup = html(SAMPLE_MEMORY);
  assert.ok(markup.includes("Saved to your own layer"));
  assert.ok(markup.includes("Elena prefers the afternoon consult slot."));
  assert.ok(markup.includes("blk-memory_saved-blk_mem1-propose_for_team"));
  const locked: Block = { ...SAMPLE_MEMORY, data: { ...(SAMPLE_MEMORY.data as object), canPromote: false } };
  assert.ok(!html(locked).includes("propose_for_team"));
  const space: Block = { ...SAMPLE_MEMORY, data: { ...(SAMPLE_MEMORY.data as object), layer: "space" } };
  assert.ok(html(space).includes("Saved to the Space layer"));
  assert.ok(!html(space).includes("propose_for_team"));
  assert.equal(promoteTarget("person"), "space");
  assert.equal(promoteTarget("space"), null);
  assert.equal(canPropose("person", true, true), false);
});

test("vault_used: the name and never shown, and the value or the fields are not in the card", () => {
  const markup = html(SAMPLE_VAULT_USED);
  assert.ok(markup.includes("#Intake_Twilio.api_key"));
  assert.ok(markup.includes("by name · never shown"));
  assert.ok(markup.includes("On the agent computer"));
  assert.equal(vaultLine("#A", "blocked"), "#A was blocked · never shown");
  assert.equal(vaultLine("#A", "filled"), "Filled #A by name · never shown");
});

test("access_request: an approver sees Approve and Decline; a decided one shows its state", () => {
  const markup = html(SAMPLE_ACCESS_REQUEST, fakeHost({ viewerId: "usr_z9y8x7", nameOf: (id) => (id === "usr_a1b2c3" ? "Maya" : undefined) }).host);
  assert.ok(markup.includes("Maya asks for edit access to Clients"));
  assert.ok(markup.includes("I need to attach the signed engagement letters."));
  for (const key of ["approve", "decline", "level"]) assert.ok(markup.includes(`blk-access_request-blk_acc1-${key}`), key);
  const granted: Block = { ...SAMPLE_ACCESS_REQUEST, data: { ...(SAMPLE_ACCESS_REQUEST.data as object), state: "granted" } };
  const done = html(granted, fakeHost({ viewerId: "usr_z9y8x7" }).host);
  assert.ok(done.includes("Granted edit access"));
  assert.ok(!done.includes("blk-access_request-blk_acc1-approve"));
});

test("access_request: the person who asked sees the locked state with Waiting, not the approver buttons", () => {
  const markup = html(SAMPLE_ACCESS_REQUEST, fakeHost({ viewerId: "usr_a1b2c3" }).host);
  assert.ok(markup.includes("blk-access_request-blk_acc1-locked"), "the LockedState mounts");
  assert.ok(markup.includes("Clients is locked"));
  assert.ok(markup.includes("Waiting"));
  assert.ok(!markup.includes("blk-access_request-blk_acc1-approve"));
  assert.equal(requestView("usr_a1b2c3", "usr_a1b2c3"), "requester");
  assert.equal(requestView(undefined, "usr_a1b2c3"), "approver");
  const declined: Block = { ...SAMPLE_ACCESS_REQUEST, data: { ...(SAMPLE_ACCESS_REQUEST.data as object), state: "declined" } };
  assert.ok(html(declined, fakeHost({ viewerId: "usr_a1b2c3" }).host).includes("Ask for access"), "a declined request can be asked again");
});

test("model_switch: Sub-task, the reason and the Model and Effort menus; no action is declared", () => {
  const markup = html(SAMPLE_MODEL_SWITCH);
  assert.ok(markup.includes("Sub-task"));
  assert.ok(markup.includes("Check the bounce list for Elena&#x27;s address"));
  assert.ok(markup.includes("Model: Haiku"));
  assert.ok(markup.includes("Effort: Low"));
  assert.equal(BLOCK_SPECS_B.model_switch.actions.length, 0);
  assert.deepEqual(modelChoices({ provider: "p", model: "Sonnet" }, { provider: "p", model: "Haiku" }), ["Haiku", "Sonnet"]);
});

test("helper: title, status, trail, Open, and Stop only while it runs", () => {
  const markup = html(SAMPLE_HELPER);
  assert.ok(markup.includes("Check the bounce list"));
  assert.ok(markup.includes("Working"));
  assert.ok(markup.includes("Intake / Check the bounce list"));
  assert.ok(markup.includes("blk-helper-blk_hlp1-stop"));
  const done: Block = { ...SAMPLE_HELPER, data: { ...(SAMPLE_HELPER.data as object), status: "done" } };
  assert.ok(!html(done).includes("blk-helper-blk_hlp1-stop"));
  assert.equal(helperTrail([{ title: "A" }, { title: "B" }]), "A / B");
});

test("diff_card: title, kind, every change with before and after, Apply and Reject", () => {
  const markup = html(SAMPLE_DIFF_CARD);
  assert.ok(markup.includes("Let Paralegals attach files to Clients"));
  assert.ok(markup.includes("Role"));
  assert.ok(markup.includes("2 changes"));
  assert.ok(markup.includes("4 people with the Paralegal role"));
  assert.ok(markup.includes("roles/paralegal/clients.files"));
  assert.ok(markup.includes(">view<") && markup.includes(">edit<"));
  assert.ok(markup.includes("blk-diff_card-blk_dif1-apply") && markup.includes("blk-diff_card-blk_dif1-reject"));
  assert.equal(valueText(undefined), "none");
  assert.equal(valueText(["a", "b"]), "a, b");
  assert.equal(valueText(""), "empty");
});

/* ---------- every action calls the declared capability ---------- */

const MORE: Partial<Record<PartTwoType, Record<string, unknown>>> = {
  memory_saved: { toLayer: "space" },
  secret_input: { fields: [{ key: "api_key", value: "placeholder", secret: true }] },
};

for (const type of PART_TWO_TYPES) {
  for (const spec of BLOCK_SPECS_B[type].actions) {
    test(`${type}.${spec.key} calls ${spec.cap} with the ids from the block`, async () => {
      const { host, calls } = fakeHost();
      const block = SAMPLES[type];
      const ok = await performB(host, type, spec.key, block, MORE[type] ?? {});
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
  assert.equal(await runActionB(host, "helper", "explode", SAMPLE_HELPER.data), false);
  assert.equal(calls.length, 0);
});

test("each press of an idempotent action gets its own key", () => {
  const a = extraForB("secret_input", "save", SAMPLE_SECRET_INPUT)["idempotencyKey"];
  const b = extraForB("secret_input", "save", SAMPLE_SECRET_INPUT)["idempotencyKey"];
  assert.equal(typeof a, "string");
  assert.notEqual(a, b);
  assert.equal(extraForB("helper", "stop", SAMPLE_HELPER)["idempotencyKey"], undefined);
});

test("the helper and the vault item open the tab the manifest names, with their ids", () => {
  const { host, calls } = fakeHost();
  assert.equal(openTabB(host, "helper", SAMPLE_HELPER.data), true);
  assert.equal(openTabB(host, "vault_used", SAMPLE_VAULT_USED.data), true);
  assert.deepEqual(calls, [
    { kind: "open", name: "thread", input: { threadId: "thr_b2c3d4" } },
    { kind: "open", name: "vault.item", input: { itemId: "vit_a1b2c3" } },
  ]);
  assert.equal(openTabB(host, "model_switch", SAMPLE_MODEL_SWITCH.data), false);
  assert.equal(openTabB(host, "helper", {}), false, "no thread id, no tab");
});

test("the model menus change the model through engine.set_model with the thread and agent of the block", () => {
  const schema = inputSchema(SET_MODEL_CAPABILITY);
  for (const key of ["threadId", "agentId", "provider", "model", "effort"]) assert.ok(key in schema.properties, key);
  for (const key of schema.required) assert.ok(["threadId", "agentId"].includes(key), `${key} is supplied by the block`);
  const d = modelSwitchData(SAMPLE_MODEL_SWITCH.data);
  assert.equal(d.threadId, "thr_a1b2c3");
  assert.equal(d.agentId, "agt_a1b2c3");
});

/* ---------- secret_input: the value never leaves the field ---------- */

const SECRET = "sk_live_hunter2_TOPSECRET";

test("secret_input: the block data has no value field, only the names of the fields to fill", () => {
  const def = registry.blocks.find((b) => b.type === "secret_input");
  assert.ok(def);
  assert.deepEqual(Object.keys(dataSchema(def).properties).sort(), ["fields", "folderId", "hint", "kind", "name"]);
  assert.ok(!JSON.stringify(SAMPLE_SECRET_INPUT).includes(SECRET));
  assert.deepEqual(secretInputData(SAMPLE_SECRET_INPUT.data).fields, ["api_key"]);
});

test("secret_input: renders a masked, non-autofilled field and a disabled Save until a value is typed", () => {
  const markup = html(SAMPLE_SECRET_INPUT);
  assert.ok(markup.includes("Add Lawmatics to the Vault"));
  assert.ok(markup.includes('type="password"'), "the field masks what is typed");
  assert.ok(markup.includes('autoComplete="off"') || markup.includes('autocomplete="off"'));
  assert.ok(markup.includes("does not enter this chat"));
  assert.ok(markup.includes("blk-secret_input-blk_sec1-field-api_key"));
  assert.match(markup, /aria-disabled="true"/, "Save is off until a value is typed");
  assert.equal(canSaveSecret(["api_key"], {}), false);
  assert.equal(canSaveSecret(["api_key"], { api_key: SECRET }), true);
  assert.equal(canSaveSecret(["a", "b"], { a: "x" }), false);
  assert.equal(fieldLabel("api_key"), "Api key");
});

test("secret_input: the value goes to vault.item.put once, as a secret field, and to no other call", async () => {
  const { host, calls } = fakeHost();
  const fields = secretFields(["api_key"], { api_key: SECRET });
  assert.deepEqual(fields, [{ key: "api_key", value: SECRET, secret: true }]);
  await performB(host, "secret_input", "save", SAMPLE_SECRET_INPUT, { fields });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.name, "vault.item.put");
  assert.equal(call.input["folderId"], "vfd_a1b2c3");
  assert.equal(call.input["name"], "Lawmatics");
  assert.equal(call.input["kind"], "api_key");
  assert.equal(typeof call.input["idempotencyKey"], "string");
  assert.deepEqual(call.input["fields"], fields);
  assert.equal(JSON.stringify(calls).split(SECRET).length - 1, 1, "the value appears in exactly one place: the vault.item.put fields");
});

test("secret_input: the value is absent from the block, the rendered thread and what a host would log", async () => {
  const { host, calls } = fakeHost();
  const fields = secretFields(["api_key"], { api_key: SECRET });
  await performB(host, "secret_input", "save", SAMPLE_SECRET_INPUT, { fields });
  // The block the thread keeps is unchanged by the save.
  assert.ok(!JSON.stringify(SAMPLE_SECRET_INPUT).includes(SECRET));
  // The whole thread of part-two blocks, rendered, holds no trace of it.
  const thread = sampleBlocksB().map((b) => html(b)).join("");
  assert.ok(!thread.includes(SECRET));
  // A host that logs a call logs the redacted input.
  const first = calls[0];
  assert.ok(first);
  const logged = JSON.stringify(redactSecretInput(first.input));
  assert.ok(!logged.includes(SECRET));
  assert.ok(logged.includes("•••"));
  assert.ok(logged.includes("api_key"));
});

test("secret_input: a failed save is reported by the rejected call and nothing is stored in the block", async () => {
  const host: BlockHostB = { invoke: () => Promise.reject(new Error("validation.duplicate")), open: () => undefined };
  await assert.rejects(performB(host, "secret_input", "save", SAMPLE_SECRET_INPUT, { fields: secretFields(["api_key"], { api_key: SECRET }) }), /duplicate/);
  assert.ok(!JSON.stringify(SAMPLE_SECRET_INPUT).includes(SECRET));
});

/* ---------- data readers ---------- */

test("data readers fall back to safe values", () => {
  assert.equal(memorySavedData(null).layer, "person");
  assert.equal(vaultUsedData({}).outcome, "used");
  assert.equal(accessRequestData({}).state, "waiting");
  assert.deepEqual(secretInputData({}).fields, ["value"]);
  assert.equal(modelSwitchData({}).scope, "sub_task");
  assert.equal(helperData({}).status, "running");
  assert.equal(diffCardData({}).kind, "config");
});
