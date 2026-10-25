// Vault requests through the real handlers (spec 2.17, ARCH 7.8): a missing key is asked for by name, goes to the folder's managers as a card each, and is supplied either by attaching an
// item or by saving new fields in the folder; the requester gets Use (a handle) and a waiting Run resumes. The value of a key never appears in the thread: not in the request, a card, an event,
// a log line or the table. The in-memory db reads the module's migration and refuses a table the host's module guard would refuse.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { columns, MIGRATION } from "../fixtures/db.ts";
import { FOLDER, NOW, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

interface RegCap { name: string; input: JsonSchema; output: JsonSchema }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: RegCap[] };
const outputOk = (cap: string, out: unknown): void => {
  const c = registry.capabilities.find((x) => x.name === cap)!;
  assert.deepEqual(validate(c.output, out, "", registry.$defs), [], `${cap} output`);
};
const codeOf = (e: unknown): string | undefined => (e && typeof e === "object" && "error" in e ? (e as { error?: { code?: string } }).error?.code : undefined);
const failed = (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: unknown) => codeOf(e) ?? String(e));

const ask = (w: World, who = "agt_helper", extra: Record<string, unknown> = {}) =>
  handlers["vault.request"](w.as(who, who.startsWith("agt") ? "agent" : "person"), { name: "Dana_Lawmatics", reason: "The intake run needs the Lawmatics key", folderId: FOLDER, idempotencyKey: `k_${who}`, ...extra } as never);

test("every capability has a real handler, the table is the module's own, and the migration names it", () => {
  for (const k of ["vault.request", "vault.requests.list", "vault.requests.get", "vault.requests.fulfil", "vault.requests.decline", "vault.requests.cancel"]) assert.equal(typeof (handlers as Record<string, unknown>)[k], "function", k);
  const tables = columns(readFileSync(MIGRATION, "utf8"));
  assert.deepEqual([...tables.keys()], ["vault_requests_requests"]);
  assert.ok(tables.get("vault_requests_requests")!.cols.every((c) => c.name.length > 0));
});

test("a request goes to the folder's managers as one card each, holds names and no value, and tells the requester its status", async () => {
  const w = world({ managers: { [FOLDER]: ["usr_mira", "usr_noah"] } });
  const out = await ask(w, "agt_helper", { forRun: "run_intake", fields: ["api_key", "account"] });
  outputOk("vault.request", out);
  const r = out.request;
  assert.deepEqual([r.name, r.fields, r.reason, r.state, r.forRun, r.folderId], ["Dana_Lawmatics", ["api_key", "account"], "The intake run needs the Lawmatics key", "waiting", "run_intake", FOLDER]);
  assert.deepEqual(r.requester, { kind: "agent", id: "agt_helper" });
  const tasks = w.called("tasks.create");
  assert.equal(tasks.length, 2, "one card for each manager");
  assert.deepEqual(tasks.map((t) => t.input["assigned"]), [{ kind: "person", id: "usr_mira" }, { kind: "person", id: "usr_noah" }]);
  const t = tasks[0]!.input;
  assert.equal(t["kind"], "unblock");
  assert.deepEqual(t["source"], { kind: "manual", id: r.id });
  assert.deepEqual(t["actions"], [{ key: "fulfil", label: "Provide the key" }, { key: "decline", label: "Decline", note: "optional" }]);
  const block = (t["blocks"] as { type: string; data: Record<string, unknown> }[])[0]!;
  assert.equal(block.type, "vault_request");
  assert.deepEqual(block.data, { requestId: r.id, name: "Dana_Lawmatics", fields: ["api_key", "account"], reason: "The intake run needs the Lawmatics key", requester: { kind: "agent", id: "agt_helper" }, forRun: "run_intake", folderId: FOLDER, state: "waiting" });
  assert.equal(r.taskId, "tsk_1");
  assert.deepEqual(w.events, [{ name: "vault.requested", subject: r.id, payload: { requestId: r.id, name: "Dana_Lawmatics", fields: ["api_key", "account"], requester: { kind: "agent", id: "agt_helper" }, forRun: "run_intake", taskId: "tsk_1" } }]);
});

test("the same idempotency key answers with the same request; a second waiting ask for the same key is a duplicate", async () => {
  const w = world();
  const a = await ask(w);
  const b = await ask(w);
  assert.equal(b.request.id, a.request.id);
  assert.equal(w.called("tasks.create").length, 1, "no second card");
  assert.equal(await failed(ask(w, "agt_helper", { idempotencyKey: "another" })), "validation.duplicate");
  assert.notEqual((await ask(w, "agt_helper", { idempotencyKey: "k3", name: "Dana_Other" })).request.id, a.request.id, "a different key is a different request");
});

test("a request needs a handle-like name, a reason and valid field names; field names default to value", async () => {
  const w = world();
  assert.equal(await failed(ask(w, "agt_helper", { name: "dana lawmatics" })), "validation.bad_input");
  assert.equal(await failed(ask(w, "agt_helper", { reason: "  " })), "validation.bad_input");
  assert.equal(await failed(ask(w, "agt_helper", { fields: ["api key"] })), "validation.bad_input");
  assert.deepEqual((await ask(w)).request.fields, ["value"]);
});

test("without a folder, or when the folder's managers cannot be read, the Space's owners and admins decide; the requester never decides their own", async () => {
  const w = world();
  const out = await ask(w, "agt_helper", { folderId: undefined });
  assert.deepEqual(w.called("tasks.create").map((t) => t.input["assigned"]), [{ kind: "person", id: "usr_admin" }, { kind: "person", id: "usr_owner" }]);
  assert.equal(out.request.folderId, undefined);
  const w2 = world({ fail: { "access.shares_of": "no access" } });
  await ask(w2);
  assert.deepEqual(w2.called("tasks.create").length, 2, "the folder could not be read, so the Space managers get it");
  assert.match(w2.warnings.join("\n"), /the folder's shares could not be read/);
  // a manager who asks is not asked
  const w3 = world();
  await handlers["vault.request"](w3.as("usr_mira"), { name: "Mine", reason: "I need it", folderId: FOLDER, idempotencyKey: "m" });
  assert.deepEqual(w3.called("tasks.create").map((t) => (t.input["assigned"] as { id: string }).id), ["usr_admin", "usr_owner"], "the folder has only Mira, so the Space managers decide Mira's own request");
  const none = world({ owners: [], admins: [], managers: {} });
  assert.equal(await failed(ask(none)), "validation.precondition_failed");
  assert.equal(none.db.dump().includes("Dana_Lawmatics"), false, "a request nobody can decide is not saved");
});

test("a manager supplies the key by saving fields in the folder: the value goes to the vault once, the requester gets Use, the cards close and the waiting Run resumes", async () => {
  const w = world();
  const { request } = await ask(w, "agt_helper", { forRun: "run_intake", fields: ["api_key"] });
  w.events.length = 0;
  const SECRET = "sk_live_9f8e7d6c5b4a";
  const done = await handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, fields: [{ key: "api_key", value: SECRET }] });
  outputOk("vault.requests.fulfil", done);
  assert.deepEqual([done.request.state, done.request.itemId, done.request.decidedAt], ["fulfilled", "vit_new", NOW]);
  const put = w.called("vault.item.put");
  assert.equal(put.length, 1);
  assert.deepEqual(put[0]!.input, { folderId: FOLDER, name: "Dana_Lawmatics", kind: "api_key", fields: [{ key: "api_key", value: SECRET, secret: true }], idempotencyKey: `${request.id}:put` });
  assert.deepEqual(w.called("vault.share").map((c) => c.input), [{ resource: { type: "vault_item", id: "vit_new" }, subject: { kind: "agent", id: "agt_helper" }, level: "use", idempotencyKey: `${request.id}:use` }]);
  assert.deepEqual(w.called("tasks.transition").map((c) => [c.input["taskId"], c.input["to"]]), [["tsk_1", "done"]]);
  assert.deepEqual(w.called("runs.resume").map((c) => c.input), [{ runId: "run_intake", reason: "key" }]);
  assert.deepEqual(w.events, [{ name: "vault.request_fulfilled", subject: request.id, payload: { requestId: request.id, itemId: "vit_new", forRun: "run_intake" } }]);
  // the value went to the vault service and nowhere else
  const everywhere = JSON.stringify({ rows: w.db.dump(), events: w.events, warnings: w.warnings, others: w.calls.filter((c) => c.cap !== "vault.item.put") });
  assert.equal(everywhere.includes(SECRET), false, "the value is in the vault call only");
  assert.equal(JSON.stringify(done).includes(SECRET), false);
  assert.equal(JSON.stringify(await handlers["vault.requests.get"](w.as("agt_helper", "agent"), { requestId: request.id })).includes(SECRET), false);
});

test("a manager can attach an item that already exists; it must hold the fields asked for", async () => {
  const w = world();
  const { request } = await ask(w, "agt_helper", { fields: ["api_key"] });
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, itemId: "vit_thin" })), "validation.precondition_failed", "that item has no api_key field");
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, itemId: "vit_none" })), "Error: no such item", "the vault refuses what the manager cannot see");
  assert.equal(w.called("vault.share").length, 0, "nothing was shared by a refused attempt");
  const done = await handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, itemId: "vit_have" });
  assert.deepEqual([done.request.state, done.request.itemId], ["fulfilled", "vit_have"]);
  assert.equal(w.called("vault.item.put").length, 0, "no new item for an attached one");
  assert.equal(w.called("vault.share")[0]!.input["level"], "use");
  assert.equal(w.called("runs.resume").length, 0, "no Run was waiting");
});

test("fulfil needs exactly one of an item and fields, every field asked for, and a folder for a new item", async () => {
  const w = world();
  const { request } = await ask(w, "agt_helper", { fields: ["api_key", "account"], folderId: undefined });
  const mgr = w.as("usr_admin");
  assert.equal(await failed(handlers["vault.requests.fulfil"](mgr, { requestId: request.id })), "validation.bad_input");
  assert.equal(await failed(handlers["vault.requests.fulfil"](mgr, { requestId: request.id, itemId: "vit_have", fields: [{ key: "api_key", value: "x" }] })), "validation.bad_input");
  assert.equal(await failed(handlers["vault.requests.fulfil"](mgr, { requestId: request.id, fields: [{ key: "api_key", value: "x" }], folderId: FOLDER })), "validation.precondition_failed", "account is missing");
  assert.equal(await failed(handlers["vault.requests.fulfil"](mgr, { requestId: request.id, fields: [{ key: "api_key", value: "x" }, { key: "account", value: "y" }] })), "validation.precondition_failed", "no folder was named by the request or the manager");
  const done = await handlers["vault.requests.fulfil"](mgr, { requestId: request.id, fields: [{ key: "api_key", value: "x" }, { key: "account", value: "y" }], folderId: FOLDER });
  assert.equal(done.request.state, "fulfilled");
  assert.equal(w.called("vault.item.put")[0]!.input["folderId"], FOLDER);
});

test("only a manager decides: the requester, a bystander and an agent get no say; a decided request cannot be decided again", async () => {
  const w = world();
  const { request } = await ask(w);
  const fields = [{ key: "value", value: "v" }];
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("agt_helper", "agent"), { requestId: request.id, fields })), "permission.no_grant", "the requester cannot supply their own key");
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("usr_bystander"), { requestId: request.id, fields })), "validation.not_found", "a stranger cannot even see it");
  assert.equal(await failed(handlers["vault.requests.decline"](w.as("usr_bystander"), { requestId: request.id })), "validation.not_found");
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("usr_mira", "agent", "usr_mira"), { requestId: request.id, fields })), undefined, "an agent acting for the manager may");
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, fields })), "validation.precondition_failed", "already fulfilled");
  assert.equal(await failed(handlers["vault.requests.decline"](w.as("usr_mira"), { requestId: request.id })), "validation.precondition_failed");
  assert.equal(await failed(handlers["vault.requests.cancel"](w.as("agt_helper", "agent"), { requestId: request.id })), "validation.precondition_failed");
  assert.equal(w.called("vault.item.put").length, 1, "the key was saved once");
});

test("declining records the note, closes the cards as canceled and tells the waiting Run's owner through the event", async () => {
  const w = world({ managers: { [FOLDER]: ["usr_mira", "usr_noah"] } });
  const { request } = await ask(w, "agt_helper", { forRun: "run_x" });
  w.events.length = 0;
  const out = await handlers["vault.requests.decline"](w.as("usr_noah"), { requestId: request.id, note: " Use the shared one " });
  outputOk("vault.requests.decline", out);
  const got = (await handlers["vault.requests.get"](w.as("agt_helper", "agent"), { requestId: request.id })).request;
  assert.deepEqual([got.state, got.note, got.decidedAt], ["declined", "Use the shared one", NOW]);
  assert.deepEqual(w.called("tasks.transition").map((c) => [c.input["taskId"], c.input["to"], c.input["note"]]), [["tsk_1", "canceled", "Declined: Use the shared one"], ["tsk_2", "canceled", "Declined: Use the shared one"]]);
  assert.deepEqual(w.events, [{ name: "vault.request_declined", subject: request.id, payload: { requestId: request.id, forRun: "run_x", note: "Use the shared one" } }]);
  assert.equal(w.called("runs.resume").length, 0, "a declined request does not resume the Run");
  assert.equal(w.called("vault.share").length, 0);
});

test("the requester can withdraw their own request, and only they can", async () => {
  const w = world();
  const { request } = await ask(w);
  assert.equal(await failed(handlers["vault.requests.cancel"](w.as("usr_mira"), { requestId: request.id })), "permission.no_grant", "a manager decides; only the requester withdraws");
  assert.equal(await failed(handlers["vault.requests.cancel"](w.as("usr_bystander"), { requestId: request.id })), "validation.not_found");
  w.events.length = 0;
  outputOk("vault.requests.cancel", await handlers["vault.requests.cancel"](w.as("agt_helper", "agent"), { requestId: request.id }));
  assert.deepEqual(w.events, [{ name: "vault.request_canceled", subject: request.id, payload: { requestId: request.id } }]);
  assert.deepEqual(w.called("tasks.transition").map((c) => [c.input["to"], c.input["note"]]), [["canceled", "Withdrawn"]]);
  assert.equal(await failed(handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, fields: [{ key: "value", value: "v" }] })), "validation.precondition_failed");
});

test("the list shows what I asked for and what waits on me as a manager, newest first, filtered by state and mine, with paging", async () => {
  const w = world();
  const a = await ask(w, "agt_helper", { idempotencyKey: "a", name: "Key_A" });
  await ask(w, "agt_helper", { idempotencyKey: "b", name: "Key_B" });
  await ask(w, "agt_other", { idempotencyKey: "c", name: "Key_C" });
  await handlers["vault.requests.cancel"](w.as("agt_helper", "agent"), { requestId: a.request.id });
  const names = async (ctx: ReturnType<World["as"]>, input: Record<string, unknown> = {}): Promise<string[]> => {
    const out = await handlers["vault.requests.list"](ctx, input as never);
    outputOk("vault.requests.list", out);
    return out.requests.map((r) => r.name);
  };
  assert.deepEqual((await names(w.as("agt_helper", "agent"))).sort(), ["Key_A", "Key_B"], "an agent sees its own");
  assert.deepEqual((await names(w.as("usr_mira"))).sort(), ["Key_A", "Key_B", "Key_C"], "a manager sees all that wait on them, decided or not");
  assert.deepEqual(await names(w.as("usr_mira"), { state: "waiting" }).then((n) => n.sort()), ["Key_B", "Key_C"]);
  assert.deepEqual(await names(w.as("usr_mira"), { state: "canceled" }), ["Key_A"]);
  assert.deepEqual(await names(w.as("usr_mira"), { mine: true }), [], "mine: nothing Mira asked for");
  assert.deepEqual((await names(w.as("agt_helper", "agent"), { mine: false })), [], "mine false: nothing waits on the agent");
  assert.deepEqual(await names(w.as("usr_bystander")), []);
  const first = await handlers["vault.requests.list"](w.as("usr_mira"), { limit: 2 });
  assert.equal(first.requests.length, 2);
  assert.equal(first.total, 3);
  assert.ok(first.next);
  const rest = await handlers["vault.requests.list"](w.as("usr_mira"), { cursor: first.next!, limit: 2 });
  assert.equal(rest.requests.length, 1);
  assert.equal(rest.next, undefined);
});

test("get shows a request to the requester and the managers and to nobody else; an agent acting for a person sees what that person asked", async () => {
  const w = world();
  const { request } = await ask(w, "usr_asker");
  outputOk("vault.requests.get", await handlers["vault.requests.get"](w.as("usr_asker"), { requestId: request.id }));
  outputOk("vault.requests.get", await handlers["vault.requests.get"](w.as("usr_mira"), { requestId: request.id }));
  assert.equal(codeOf(await handlers["vault.requests.get"](w.as("usr_bystander"), { requestId: request.id }).catch((e: unknown) => e)), "validation.not_found");
  const viaAgent = await handlers["vault.requests.get"](w.as("agt_x", "agent", "usr_asker"), { requestId: request.id });
  assert.equal(viaAgent.request.id, request.id);
  assert.equal(codeOf(await handlers["vault.requests.get"](w.as("usr_mira"), { requestId: "vrq_missing" }).catch((e: unknown) => e)), "validation.not_found");
});

test("a card that will not close is logged and the decision stands; a Run that will not resume is logged too", async () => {
  const w = world({ fail: { "tasks.transition": "tasks down", "runs.resume": "runs down" } });
  const { request } = await ask(w, "agt_helper", { forRun: "run_z" });
  const done = await handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, fields: [{ key: "value", value: "v" }] });
  assert.equal(done.request.state, "fulfilled", "fulfilled although the card and the Run misbehaved");
  assert.match(w.warnings.join("\n"), /card did not close/);
  assert.match(w.warnings.join("\n"), /the waiting run did not resume/);
});

test("every statement the module runs names only its own table", async () => {
  const w = world();
  const { request } = await ask(w);
  await handlers["vault.requests.fulfil"](w.as("usr_mira"), { requestId: request.id, fields: [{ key: "value", value: "v" }] });
  await handlers["vault.requests.list"](w.as("usr_mira"), {});
  assert.ok(w.db.statements.length >= 5);
  assert.ok(w.db.statements.every((s) => /vault_requests_requests/.test(s)));
});
