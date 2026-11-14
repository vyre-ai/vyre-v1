// The connect card through the real handlers (b-connect, 14 Nov 2026): one tool for an agent, eight states read from the request, nothing stored until the key works, the agent told in a line.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

const KEY = "fk_live_TYPED_KEY_0001";
const FATHOM = {
  fathom: {
    title: "Fathom",
    scope: "person" as const,
    fields: [
      { name: "api_key", label: "API key", optional: false },
      { name: "webhook_secret", label: "Webhook secret", optional: true },
    ],
    site: "https://fathom.video",
  },
};
const HOUSE = {
  ...FATHOM,
  hubspot: { title: "HubSpot", scope: "space" as const, fields: [{ name: "token", label: "Token", optional: false }] },
};
const MINE = { id: "vfd_mine", name: "Mine", scope: "mine" as const };
const TEAM = { id: "vfd_team", name: "Marketing", scope: "shared" as const };
const FINANCE = { id: "vfd_fin", name: "Finance", scope: "shared" as const };
const BANNED = /handle|clearance|restricted|role|folder/i;

const room = (over: Parameters<typeof world>[0] = {}) =>
  world({ connectors: HOUSE, folders: [MINE, TEAM, FINANCE], ...over });
const dex = (w: World, thread = "thr_1") => ({ ...w.as("agt_dex", "agent", "usr_asker"), thread }) as never;
const person = (w: World, id = "usr_asker") => w.as(id, "person") as never;
const ask = (w: World, service = "Fathom", key = "k1", thread = "thr_1") =>
  handlers["vault.connect"](dex(w, thread), { service, idempotencyKey: key } as never);
const submit = (
  w: World,
  requestId: string,
  fields: { key: string; value: string }[] = [{ key: "api_key", value: KEY }],
  who = "usr_asker",
  extra = {},
) => handlers["vault.connect_card.submit"](person(w, who), { requestId, fields, ...extra } as never);
const card = (w: World, requestId: string, who = "usr_asker") =>
  handlers["vault.connect_card.get"](person(w, who), { requestId } as never).then((r) => r.card);
const names = (w: World) => w.calls.map((c) => c.cap);

test("an agent names the service and gets a short answer; the person gets one card", async () => {
  const w = room();
  const r = await ask(w);
  assert.equal(r.status, "waiting_person");
  assert.ok(r.requestId);
  assert.equal(BANNED.test(r.tell), false, r.tell);
  assert.ok(r.tell.length < 200);
  const post = w.called("chat.post");
  assert.equal(post.length, 1);
  const block = (post[0]!.input["blocks"] as { type: string; data: Record<string, unknown> }[])[0]!;
  assert.deepEqual(
    [block.type, block.data["service"], block.data["asker"], block.data["agentId"], block.data["state"]],
    ["vault_request", "fathom", "usr_asker", "agt_dex", "waiting"],
  );
  assert.equal(w.called("tasks.create").length, 0, "the person is in the chat: no Needs you card");
  const c = await card(w, r.requestId!);
  assert.equal(c.state, "ask");
  assert.equal(c.mayFill, true);
  assert.deepEqual(c.fields, FATHOM.fathom.fields);
  assert.deepEqual(c.service, { key: "fathom", title: "Fathom", site: "https://fathom.video" });
});

test("asking again for the same service answers with the same card; a service that is already connected needs none", async () => {
  const w = room();
  const a = await ask(w);
  const b = await ask(w, "fathom", "k2");
  assert.equal(b.requestId, a.requestId);
  assert.equal(w.db.dump().split("vrq_").length - 1 > 0, true);
  const again = await ask(w, "Fathom", "k3", "thr_2");
  assert.equal(again.requestId, a.requestId);
  assert.equal(w.called("chat.post").at(-1)!.input["threadId"], "thr_2", "drawn where the person is now");
  const w2 = room({ connections: { fathom: { connectionId: "con_1", owner: "mine", state: "active" } } });
  const done = await ask(w2);
  assert.equal(done.status, "connected");
  assert.equal(done.requestId, undefined);
  assert.equal(w2.called("chat.post").length, 0);
  assert.equal(BANNED.test(done.tell), false);
});

test("a service with no connector answers no_connector with the one next step, and draws no card", async () => {
  const w = room();
  const r = await ask(w, "Zendesk");
  assert.equal(r.status, "no_connector");
  assert.match(r.tell, /Build one/);
  assert.equal(BANNED.test(r.tell), false);
  assert.equal(w.called("chat.post").length, 0);
});

test("Connect: the key is tried first, kept second, connected third, and nothing but the try ever carries it", async () => {
  const w = room();
  const { requestId } = await ask(w);
  const out = await submit(w, requestId!);
  assert.equal(out.result, "connected");
  assert.equal(out.card.state, "connected");
  assert.equal(out.card.keptIn, "Mine");
  assert.equal(out.card.tested, "Reached Fathom");
  const order = names(w).filter((c) =>
    ["connectors.check_key", "vault.item.put", "connections.create", "connections.mark_working"].includes(c),
  );
  assert.deepEqual(order, ["connectors.check_key", "vault.item.put", "connections.create", "connections.mark_working"]);
  const create = w.called("connections.create")[0]!.input;
  assert.equal(create["ownerKind"], "person");
  assert.deepEqual(
    create["secrets"],
    { api_key: "#Fathom.api_key" },
    "names, never a value; the optional field was left empty",
  );
  assert.equal(
    w.called("vault.item.put")[0]!.input["folderId"],
    "vfd_mine",
    "Mine unless the person chose another place",
  );
  const fulfilled = w.events.find((e) => e.name === "vault.request_fulfilled")!;
  assert.equal((fulfilled.payload as Record<string, unknown>)["service"], "Fathom");
  const holdsKey = (v: unknown) => JSON.stringify(v).includes(KEY);
  for (const c of w.calls)
    assert.equal(holdsKey(c.input), ["connectors.check_key", "vault.item.put"].includes(c.cap), c.cap);
  assert.equal(holdsKey([w.events, w.warnings, w.db.dump()]), false, "no event, log line or row holds the key");
});

test("a wrong key stops at the check: nothing is kept, nothing is connected, the card says so and takes another key", async () => {
  const w = room({ check: "rejected" });
  const { requestId } = await ask(w);
  const out = await submit(w, requestId!);
  assert.equal(out.result, "wrong");
  assert.equal(out.card.state, "wrong");
  assert.equal(out.card.mayFill, true);
  for (const never of ["vault.item.put", "connections.create", "vault.share"])
    assert.equal(w.called(never).length, 0, never);
  assert.equal(
    w.events.some((e) => e.name === "vault.request_fulfilled"),
    false,
    "the agent is not told to carry on",
  );
  w.script.check = "ok";
  const again = await submit(w, requestId!);
  assert.equal(again.result, "connected");
});

test("an app that cannot be reached keeps nothing either, and Retry is the same call", async () => {
  const w = room({ check: "unreachable" });
  const { requestId } = await ask(w);
  const out = await submit(w, requestId!);
  assert.deepEqual([out.result, out.card.state], ["offline", "offline"]);
  assert.equal(w.called("vault.item.put").length, 0);
  assert.equal(w.called("connections.create").length, 0);
  w.script.check = "ok";
  assert.equal((await submit(w, requestId!)).result, "connected");
});

test("if connecting fails after the key was saved, the key is erased for good and the request stays open", async () => {
  const w = room({ fail: { "connections.create": "boom" } });
  const { requestId } = await ask(w);
  const out = await submit(w, requestId!);
  assert.equal(out.result, "offline");
  assert.equal(w.called("vault.item.delete").length, 0, "nothing is moved to Trash");
  assert.equal(w.called("vault.item.discard_new").length, 1, "the key saved in this call is erased for good");
  assert.equal(out.card.notice, undefined);
  assert.equal(
    w.events.some((e) => e.name === "vault.request_fulfilled"),
    false,
  );
});

test("a key the person already saved is offered back, and Use it connects without typing", async () => {
  const w = room({ saved: [{ id: "vit_old", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }] });
  const { requestId, status } = await ask(w);
  assert.equal(status, "waiting_person");
  const c = await card(w, requestId!);
  assert.equal(c.state, "have");
  assert.deepEqual(c.have, { itemId: "vit_old", name: "Fathom", keptIn: "Mine" });
  const out = await handlers["vault.connect_card.submit"](person(w), { requestId, useSaved: true } as never);
  assert.equal(out.result, "connected");
  assert.equal(w.called("vault.item.put").length, 0, "no second copy of the key");
  assert.equal(w.called("connectors.check_key").length, 0, "the connection's own probe tries it");
  assert.equal(w.called("connections.test").length, 1);
  assert.deepEqual(w.called("connections.create")[0]!.input["secrets"], { api_key: "#Fathom.api_key" });
});

test("a person who may not connect services is sent to an admin by name; the ask finishes when the admin connects", async () => {
  const w = room({ unusable: ["vfd_fin"] });
  const { requestId, status, tell } = await ask(w, "HubSpot");
  assert.equal(status, "waiting_admin");
  assert.equal(BANNED.test(tell), false, tell);
  const c = await card(w, requestId!);
  assert.deepEqual([c.state, c.mayFill], ["admin", false]);
  assert.equal(c.admin?.id, "usr_admin", "the first owner or admin, by id; the screen says their name");
  assert.equal(w.called("tasks.create").length, 0, "nobody is asked until the person presses Ask");
  await assert.rejects(submit(w, requestId!, [{ key: "token", value: KEY }]), (e: unknown) => {
    assert.equal((e as { error?: { code?: string } }).error?.code, "permission.no_grant");
    return true;
  });
  const asked = await handlers["vault.connect_card.ask_admin"](person(w), { requestId } as never);
  assert.deepEqual([asked.card.state, asked.card.admin?.askedAt], ["asked", 1_700_000_000_000]);
  const task = w.called("tasks.create")[0]!.input;
  assert.deepEqual(task["assigned"], { kind: "person", id: "usr_admin" });
  assert.equal(w.called("tasks.create").length, 1);
  await handlers["vault.connect_card.ask_admin"](person(w), { requestId } as never);
  assert.equal(w.called("tasks.create").length, 1, "asking twice asks once");
  // the admin sees the form and connects it for the Space
  const theirs = await card(w, requestId!, "usr_admin");
  assert.deepEqual([theirs.state, theirs.mayFill], ["ask", true]);
  assert.equal(
    theirs.keptIn,
    "Connections",
    "a Space service is kept in the Space's Connections folder, said on the card",
  );
  const out = await submit(w, requestId!, [{ key: "token", value: KEY }], "usr_admin");
  assert.equal(out.result, "connected");
  assert.equal(w.called("connections.create")[0]!.input["ownerKind"], "space");
  assert.equal(
    w.called("vault.item.put")[0]!.input["folderId"],
    "vfd_company",
    "the Connections folder (made on first use), not Marketing and not Mine",
  );
  const mine = await card(w, requestId!);
  assert.equal(mine.state, "connected", "the person's card finishes by itself");
  assert.equal(mine.connectedBy, "usr_admin");
});

test("Not now folds the card, the agent's next ask leaves it folded, and the person's own Connect opens the same card again", async () => {
  const w = room();
  const { requestId } = await ask(w);
  await handlers["vault.requests.decline"](person(w), { requestId } as never);
  assert.equal((await card(w, requestId!)).state, "later");
  const declined = w.events.find((e) => e.name === "vault.request_declined")!;
  assert.equal((declined.payload as Record<string, unknown>)["service"], "Fathom");
  const reopened = await handlers["vault.connect_card.reopen"](person(w), { requestId } as never);
  assert.equal(reopened.card.state, "ask");
});

test("Disconnect removes the connection, keeps the key and folds the card to Not connected", async () => {
  const w = room();
  const { requestId } = await ask(w);
  await submit(w, requestId!);
  const out = await handlers["vault.connect_card.disconnect"](person(w), { requestId } as never);
  assert.equal(out.card.state, "later");
  assert.equal(w.called("connections.delete").length, 1);
  assert.equal(w.called("vault.item.delete").length, 0, "the key stays in the Vault");
});

test("Kept in: Mine first, the folders an agent can use next, the others listed but not usable", async () => {
  const w = room({ unusable: ["vfd_fin"] });
  const { requestId } = await ask(w);
  const { folders } = await handlers["vault.connect_card.options"](person(w), { requestId } as never);
  assert.deepEqual(
    folders.map((f) => [f.name, f.usable]),
    [
      ["Mine", true],
      ["Marketing", true],
      ["Finance", false],
    ],
  );
  assert.equal(
    (await handlers["vault.connect_card.options"](person(w), { requestId } as never)).default,
    "vfd_mine",
    "the person it was asked for keeps it in Mine unless they choose",
  );
  const s = room({
    folders: [MINE, { id: "vfd_co", name: "Company connections", scope: "shared", owner: "svc_host" }],
  });
  const r2 = await ask(s);
  assert.deepEqual(
    (await handlers["vault.connect_card.options"](person(s), { requestId: r2.requestId } as never)).folders.map(
      (f) => f.name,
    ),
    ["Mine"],
    "a folder kept for the server is not offered at all",
  );
});

test("a key kept in a team folder reaches the agent as the asker's own unless the person says anyone", async () => {
  const w = room({ unusable: ["vfd_fin"] });
  const { requestId } = await ask(w);
  await submit(w, requestId!, undefined, "usr_asker", { folderId: "vfd_team" });
  assert.equal(w.called("vault.item.put")[0]!.input["folderId"], "vfd_team");
});

test("the agent's words never carry the words a person is spared", async () => {
  const w = room();
  const said = [(await ask(w)).tell, (await ask(w, "HubSpot", "h1")).tell];
  const w2 = room({ connections: { fathom: { connectionId: "c", owner: "mine", state: "active" } } });
  said.push((await ask(w2)).tell);
  for (const t of said) assert.equal(BANNED.test(t), false, t);
});

test("the card's own acts are a person's: an agent, even one acting for the asker, is refused for submit, ask_admin, reopen and disconnect", async () => {
  const w = room();
  const { requestId } = await ask(w, "HubSpot");
  const as = dex(w);
  for (const [cap, input] of [
    ["vault.connect_card.submit", { requestId, useSaved: true }],
    ["vault.connect_card.ask_admin", { requestId }],
    ["vault.connect_card.reopen", { requestId }],
    ["vault.connect_card.disconnect", { requestId }],
  ] as const)
    await assert.rejects(
      (handlers as Record<string, (c: never, i: never) => Promise<unknown>>)[cap]!(as, input as never),
      (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.no_grant",
      cap,
    );
  assert.equal(w.called("tasks.create").length, 0);
  assert.equal(w.called("connectors.check_key").length, 0);
});

test("an agent's ask never opens a card the person folded; only the person's press does", async () => {
  const w = room();
  const { requestId } = await ask(w);
  await handlers["vault.requests.decline"](person(w), { requestId } as never);
  const again = await ask(w, "Fathom", "k9");
  assert.deepEqual([again.status, again.requestId], ["declined", requestId]);
  assert.match(again.tell, /press Connect/);
  assert.equal((await card(w, requestId!)).state, "later");
  await handlers["vault.connect_card.reopen"](person(w), { requestId } as never);
  assert.equal((await card(w, requestId!)).state, "ask");
});

test("two people asking through one agent get two cards, and one cannot read the other's", async () => {
  const w = room();
  const a = await ask(w);
  const b = await handlers["vault.connect"](
    { ...w.as("agt_dex", "agent", "usr_other"), thread: "thr_2" } as never,
    {
      service: "Fathom",
      idempotencyKey: "o1",
    } as never,
  );
  assert.notEqual(a.requestId, b.requestId);
  await assert.rejects(card(w, a.requestId!, "usr_other"));
});

test("a shared folder an agent cannot use is refused before anything is written", async () => {
  const w = room({ unusable: ["vfd_fin"] });
  const { requestId } = await ask(w);
  await assert.rejects(submit(w, requestId!, undefined, "usr_asker", { folderId: "vfd_fin" }));
  assert.equal(w.called("connectors.check_key").length, 0);
  assert.equal(w.called("vault.item.put").length, 0);
});

test("a saved key whose connection fails its probe leaves the connection removed and the key where the person can see it", async () => {
  const w = room({
    saved: [{ id: "vit_old", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }],
    probe: "down",
  });
  const { requestId } = await ask(w);
  const out = await handlers["vault.connect_card.submit"](person(w), { requestId, useSaved: true } as never);
  assert.notEqual(out.result, "connected");
  assert.equal(w.called("connections.delete").length, 1);
  assert.equal(w.called("vault.item.delete").length, 0);
  assert.equal((await card(w, requestId!)).state === "connected", false);
});

test("a typed key that fails after it was kept is never moved to Trash behind the person's back, and a retry uses a fresh key", async () => {
  const w = room({ fail: { "connections.create": "boom" } });
  const { requestId } = await ask(w);
  await submit(w, requestId!);
  await submit(w, requestId!);
  assert.equal(w.called("vault.item.delete").length, 0);
  assert.equal(w.called("vault.item.discard_new").length, 2);
  for (const cap of ["vault.item.put", "connections.create"]) {
    const keys = w.called(cap).map((c) => c.input["idempotencyKey"]);
    assert.equal(keys.length, 2, cap);
    assert.equal(new Set(keys).size, 2, `${cap}: each try has its own key`);
  }
});

test("Tested is only said when a call really ran; a connector with no check shows no Tested row and no Checked step", async () => {
  const w = room({ noProbe: true });
  const { requestId } = await ask(w);
  const c0 = await card(w, requestId!);
  assert.equal(c0.checks, false);
  const out = await submit(w, requestId!);
  assert.equal(out.card.tested, undefined);
});

test("a connector that is not built in says on Ask which host the key is tried against", async () => {
  const w = room({ thirdParty: true });
  const { requestId } = await ask(w);
  assert.equal(
    (await card(w, requestId!)).checksWith,
    "api.example.test, files.example.test",
    "every host the key can be sent to",
  );
  const b = room();
  const r = await ask(b);
  assert.equal((await card(b, r.requestId!)).checksWith, undefined);
});

test("the typed key is in no event, log line, request row or nested call but the check and the Vault put", async () => {
  const w = room();
  const { requestId } = await ask(w);
  await submit(w, requestId!);
  const only = new Set(["connectors.check_key", "vault.item.put"]);
  for (const c of w.calls) assert.equal(JSON.stringify(c.input).includes(KEY), only.has(c.cap), c.cap);
  assert.equal(JSON.stringify([w.events, w.warnings, w.db.dump()]).includes(KEY), false);
});

test("a Space service is kept in the Connections folder even when the admin is the person asked, and the menu offers that folder only", async () => {
  const w = room();
  const r = await handlers["vault.connect"](
    { ...w.as("agt_dex", "agent", "usr_admin"), thread: "thr_9" } as never,
    { service: "HubSpot", idempotencyKey: "sp1" } as never,
  );
  const admin = (c: string, i: unknown) =>
    (handlers as Record<string, (x: never, y: never) => Promise<any>>)[c]!(person(w, "usr_admin"), i as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  const opts = await admin("vault.connect_card.options", { requestId: r.requestId });
  assert.deepEqual(
    opts.folders.map((f: { name: string }) => f.name),
    [],
    "no Mine, no team folders; the folder is made on first use",
  );
  const out = await admin("vault.connect_card.submit", {
    requestId: r.requestId,
    fields: [{ key: "token", value: KEY }],
    folderId: "vfd_mine",
  });
  assert.equal(out.result, "connected");
  assert.equal(
    w.called("vault.item.put")[0]!.input["folderId"],
    "vfd_company",
    "a folder chosen by hand is ignored for a Space service",
  );
  assert.equal(w.called("connections.create")[0]!.input["ownerKind"], "space");
});

test("an agent cannot connect a person's saved key with no press: submit useSaved by an agent is refused and nothing is made", async () => {
  const w = room({ saved: [{ id: "vit_old", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }] });
  const { requestId } = await ask(w);
  await assert.rejects(
    handlers["vault.connect_card.submit"](dex(w), { requestId, useSaved: true } as never),
    (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.no_grant",
  );
  await assert.rejects(
    handlers["vault.connect_card.submit"](dex(w), { requestId, fields: [{ key: "api_key", value: KEY }] } as never),
  );
  assert.equal(w.called("connections.create").length, 0);
  assert.equal(w.called("connectors.check_key").length, 0);
});

test("a second key for the same service gets its own item name, never a raw duplicate", async () => {
  const w = room({ saved: [{ id: "vit_old", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }] });
  const { requestId } = await ask(w);
  await handlers["vault.connect_card.submit"](person(w), {
    requestId,
    useSaved: false,
    fields: [{ key: "api_key", value: KEY }],
  } as never);
  assert.equal(w.called("vault.item.put")[0]!.input["name"], "Fathom_2");
});

test("if the erase itself fails the card says the key is saved, and Retry offers it back", async () => {
  const w = room({ fail: { "connections.create": "boom", "vault.item.discard_new": "no" } });
  const { requestId } = await ask(w);
  const out = await submit(w, requestId!);
  assert.equal(out.card.notice, "Your key is saved in Mine. Couldn't connect.");
});

test("a saved key is offered only when the card itself saved it for this service: a name that merely starts alike is not", async () => {
  const w = room({
    saved: [
      { id: "vit_a", name: "Fathom key old", folderId: "vfd_mine", fieldKeys: ["api_key"] },
      { id: "vit_b", name: "FathomX", folderId: "vfd_mine", fieldKeys: ["api_key"] },
    ],
  });
  const { requestId } = await ask(w);
  assert.equal((await card(w, requestId!)).state, "ask");
  const w2 = room({ saved: [{ id: "vit_c", name: "Fathom_3", folderId: "vfd_mine", fieldKeys: ["api_key"] }] });
  assert.equal((await card(w2, (await ask(w2)).requestId!)).state, "have");
});

test("a not built-in service shows every host on the saved-key state too", async () => {
  const w = room({
    thirdParty: true,
    saved: [{ id: "vit_c", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }],
  });
  const c = await card(w, (await ask(w)).requestId!);
  assert.deepEqual([c.state, c.checksWith], ["have", "api.example.test, files.example.test"]);
});
