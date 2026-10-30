// Ask on an Automation: an existing Vault account is named, a missing one becomes paste slots, and the pasted value never enters the line.
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountFromCreate, connectionCreateInput, firstFolderId, handleOf, itemIdOf, linesFor, linkAccount, planAsk, savedLine, setupShape, vaultPutInput,
} from "./plan.ts";
import type { AccountOption } from "../connect/accounts.ts";
import type { Definition } from "../canvas/model.ts";

const google = (id: string, title: string, state = "active"): AccountOption => ({ app: "google", id, title, state });
const steps = [
  { key: "google.gmail.list_messages", title: "List Gmail messages" },
  { key: "google.gmail.send_message", title: "Send a Gmail message" },
  { key: "connector_request", title: "Authenticated request" },
];

const empty = (): Definition => ({ triggers: [{ key: "manual" }], start: ["s"], nodes: [{ id: "s", key: "stop", input: {} }] });

test("an existing Google account is named and the catalog step is chosen", () => {
  const turn = planAsk({ text: "list gmail messages", accounts: [google("con_g", "Work Gmail")], steps });
  assert.equal(turn.kind, "use");
  if (turn.kind !== "use") return;
  assert.equal(turn.account.id, "con_g");
  assert.equal(turn.stepKey, "google.gmail.list_messages");
  assert.match(turn.say, /Work Gmail/);
  assert.equal(turn.say.includes("sk-"), false);
});

test("two accounts are listed and neither is written until one is picked", () => {
  const turn = planAsk({ text: "gmail", accounts: [google("con_a", "Work"), google("con_b", "Home")], steps });
  assert.equal(turn.kind, "choose");
  if (turn.kind !== "choose") return;
  assert.deepEqual(turn.accounts.map((account) => account.id), ["con_a", "con_b"]);
  assert.match(turn.say, /Work/);
  assert.match(turn.say, /Home/);
});

test("a known app with no account opens the connection screen instead of a password box", () => {
  const turn = planAsk({ text: "send a gmail message", accounts: [], steps });
  assert.equal(turn.kind, "sign_in");
  if (turn.kind !== "sign_in") return;
  assert.equal(turn.service, "google");
  assert.match(turn.say, /Sign in/);
  assert.match(turn.say, /does not take the password/);
});

test("an unknown app asks for a document already in hand", () => {
  const turn = planAsk({ text: "create a stripe customer", accounts: [], steps });
  assert.equal(turn.kind, "need_doc");
  if (turn.kind !== "need_doc") return;
  assert.equal(turn.app, "stripe");
  assert.match(turn.say, /OpenAPI document you already have/);
  const slack = planAsk({ text: "list channels in slack", accounts: [], steps });
  assert.equal(slack.app, "slack");
  assert.match(turn.say, /not opened/);
  assert.equal(turn.say.includes("https://"), false);
});

test("document fields become Vault keys and the pasted value stays off the line", () => {
  const secret = "sk-live-do-not-keep";
  const turn = planAsk({
    text: "stripe create a customer",
    accounts: [],
    steps,
    fields: [{ name: "Client id", secret: false }, { name: "Client secret", secret: true }],
    action: "createCustomer",
  });
  assert.equal(turn.kind, "paste");
  if (turn.kind !== "paste") return;
  assert.deepEqual(turn.slots.map((slot) => slot.key), ["CLIENT_ID", "CLIENT_SECRET"]);
  assert.equal(turn.slots[1]!.secret, true);
  assert.equal(turn.stepKey, "connector_request");
  assert.equal(turn.action, "createCustomer");
  const lines = linesFor(`use ${secret} for stripe`, turn);
  const blob = JSON.stringify(lines) + turn.say;
  assert.equal(blob.includes(secret), false);
  assert.match(lines[0]!.say, /\[redacted\]/);
  const put = vaultPutInput({ folderId: "fld_1", app: "stripe", slots: turn.slots, values: { CLIENT_ID: "pk_test", CLIENT_SECRET: secret } });
  assert.ok(!("error" in put));
  if ("error" in put) return;
  assert.equal(put.put.fields[1]!.value, secret);
  assert.equal(savedLine(put.name, true).includes(secret), false);
  const created = connectionCreateInput({ app: "stripe", handle: "hnd_1", slots: turn.slots });
  assert.equal(created.secrets.CLIENT_SECRET, "hnd_1");
  assert.equal(JSON.stringify(created).includes(secret), false);
});

test("a draft result keeps field names and drops a copied value", () => {
  const shape = setupShape({
    setup: { fields: [{ name: "X-Api-Key", secret: true, value: "sk-live-do-not-keep" }] },
    actions: [{ key: "listNotes", url: "https://secret.example/sk-live-do-not-keep" }],
  });
  assert.deepEqual(shape.fields, [{ name: "X-Api-Key", secret: true }]);
  assert.deepEqual(shape.actions, ["listNotes"]);
  assert.equal(JSON.stringify(shape).includes("sk-live"), false);
  assert.equal(JSON.stringify(shape).includes("https://"), false);
});

test("linking writes the account onto the matching step and can add a catalog step", () => {
  const account = google("con_g", "Work Gmail");
  const start = empty();
  const added = linkAccount(start, { account, stepKey: "google.gmail.list_messages", nodeId: null });
  assert.ok("def" in added);
  if (!("def" in added)) return;
  const node = added.def.nodes.find((item) => item.id === added.nodeId);
  assert.equal(node?.key, "google.gmail.list_messages");
  assert.equal((node?.input as { connectionId?: string }).connectionId, "con_g");
  assert.equal((node?.input as { connector?: string }).connector, "google");
  const again = linkAccount(added.def, { account: google("con_h", "Home"), stepKey: "google.gmail.list_messages", nodeId: added.nodeId });
  assert.ok("def" in again);
  if (!("def" in again)) return;
  assert.equal(again.nodeId, added.nodeId);
  assert.equal(again.def.nodes.length, added.def.nodes.length);
  assert.equal((again.def.nodes.find((item) => item.id === again.nodeId)?.input as { connectionId?: string }).connectionId, "con_h");
});

test("folder, item, and handle reads ignore every field except the id", () => {
  assert.equal(firstFolderId({ folders: [{ id: "fld_mine", name: "Mine" }] }), "fld_mine");
  assert.equal(itemIdOf({ item: { id: "vit_1", fields: [{ key: "TOKEN", value: "secret" }] } }), "vit_1");
  assert.equal(handleOf({ handle: "hnd_1", value: "secret" }), "hnd_1");
  const account = accountFromCreate({ connection: { connectionId: "con_1", connector: "stripe", title: "Stripe", state: "active", secret: "no" } }, "stripe");
  assert.deepEqual(account, { app: "stripe", id: "con_1", title: "Stripe", state: "active" });
});
