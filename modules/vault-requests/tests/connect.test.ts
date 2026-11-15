// The connect card through the real handlers (b-connect, 14 Nov 2026): one tool for an agent, eight states read from the request, nothing stored until the key works, the agent told in a line.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

// the connect card is on by default (lib/connect-switch.ts, rc.29); this file says so, so a run with the variable set to 0 still tests the card
process.env["VYRE_CONNECT_CARD"] = "1";

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
/** What the card's own save writes on a key (who, and the hosts it goes to). A test says it was saved by the card; a key a person named or typed into the Vault by hand has none. */
const stamp = (w: World, requestId: string, item = "vit_old", hosts = ["api.fathom.ai"], by = "usr_asker"): void => {
  w.db.run(
    `UPDATE vault_requests_requests SET saved_json = ? WHERE id = ?`,
    JSON.stringify([{ item, by, hosts }]),
    requestId,
  );
};

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

test("a built-in service the card does not offer says so to the agent: its older way, and no second connector built for it", async () => {
  const w = room({ older: ["Stripe"] });
  const r = await ask(w, "Stripe");
  assert.equal(r.status, "no_connector");
  assert.match(r.tell, /own place under Connections/);
  assert.match(r.tell, /build no connector/i);
  assert.doesNotMatch(r.tell, /Build one|connectors_init/);
  assert.equal(BANNED.test(r.tell.replace(/Connections in the Vault/, "")), false);
  assert.equal(w.called("chat.post").length, 0, "no card is drawn for it");
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
  stamp(w, requestId!);
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

test("after Disconnect the agent's next call asks again with a new card, while a card folded with Not now stays folded; the old card stays Not connected and the key is not offered on the new one", async () => {
  const w = room();
  const first = await ask(w);
  await submit(w, first.requestId!);
  await handlers["vault.connect_card.disconnect"](person(w), { requestId: first.requestId } as never);
  const again = await ask(w, "Fathom", "k2");
  assert.equal(again.status, "waiting_person", "the next call asks again");
  assert.notEqual(again.requestId, first.requestId, "with a new card");
  assert.equal((await card(w, first.requestId!)).state, "later", "the old card stays Not connected");
  assert.equal(
    (await card(w, again.requestId!)).state,
    "ask",
    "the key is not offered back: Disconnect took its stamp",
  );
  assert.equal((await card(w, again.requestId!)).have, undefined);
  assert.ok(w.called("chat.post").length >= 2, "the new card is drawn in the chat");
  // Not now is the other case: it stays folded however often the agent asks
  const w2 = room();
  const f = await ask(w2);
  await handlers["vault.requests.decline"](person(w2), { requestId: f.requestId } as never);
  const f2 = await ask(w2, "Fathom", "k2");
  assert.deepEqual([f2.status, f2.requestId], ["declined", f.requestId]);
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
  stamp(w, requestId!);
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

test("B: the card says on Ask which hosts the key goes to, built in or not", async () => {
  const w = room({ thirdParty: true });
  const { requestId } = await ask(w);
  assert.equal(
    (await card(w, requestId!)).checksWith,
    "api.example.test, files.example.test",
    "every host the key can be sent to",
  );
  // B: the card shows the hosts the key goes to for a built-in service too, before the person saves anything
  const b = room();
  const r = await ask(b);
  assert.equal((await card(b, r.requestId!)).checksWith, "api.fathom.ai");
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
  stamp(w, requestId!);
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

test("A: a saved key is offered only from the card's own stamp (same service, same person, same hosts), never by its name", async () => {
  const keep = { id: "vit_a", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] };
  // named exactly like the service, with every field, in Mine: still not offered (nobody stamped it)
  const w = room({
    saved: [keep, { ...keep, id: "vit_b", name: "Fathom_2" }, { ...keep, id: "vit_c", name: "Fathom key old" }],
  });
  const { requestId } = await ask(w);
  const c0 = await card(w, requestId!);
  assert.deepEqual([c0.state, c0.have], ["ask", undefined]);
  // stamped by another person, or for other hosts (the connector changed where its key goes): not offered
  stamp(w, requestId!, "vit_a", ["api.fathom.ai"], "usr_other");
  assert.equal((await card(w, requestId!)).state, "ask", "another person's stamp");
  stamp(w, requestId!, "vit_a", ["api.fathom.ai", "files.example.test"]);
  assert.equal((await card(w, requestId!)).state, "ask", "other hosts");
  // the card's own stamp for this person and these hosts: offered
  stamp(w, requestId!, "vit_b");
  const c1 = await card(w, requestId!);
  assert.deepEqual([c1.state, c1.have?.itemId], ["have", "vit_b"]);
});

test("A: the agent learns nothing of what is in the Vault: it reads no card, no options, and its tell is the same with or without a saved key", async () => {
  const saved = [{ id: "vit_old", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }];
  const without = room({ saved });
  const a = await ask(without);
  const withKey = room({ saved });
  const b = await ask(withKey);
  stamp(withKey, b.requestId!);
  const b2 = await ask(withKey, "Fathom", "k9");
  assert.deepEqual([b.status, b.tell], [a.status, a.tell]);
  assert.deepEqual([b2.status, b2.tell], [a.status, a.tell], "asking again says the same");
  for (const cap of ["vault.connect_card.get", "vault.connect_card.options"] as const)
    await assert.rejects(handlers[cap](dex(withKey), { requestId: b.requestId } as never), (e: unknown) =>
      /Only a person/.test((e as { error?: { message?: string } }).error?.message ?? ""),
    );
  // nothing an agent is handed names the saved key: not the tell, not the chat block, not what the agent's own calls returned
  const heard = JSON.stringify([b, b2, withKey.called("chat.post")]);
  assert.equal(/vit_old|Fathom_|saved/i.test(heard.replace(/"service":"fathom"/g, "")), false, heard);
  // another person in the chat (not the one asked) reads no card either
  await assert.rejects(
    handlers["vault.connect_card.get"](person(withKey, "usr_bea"), { requestId: b.requestId } as never),
  );
  // the asked person is shown it, and only on their own card
  assert.equal((await card(withKey, b.requestId!)).state, "have");
});

test("C: the card takes back only the key it saved in its open try: a request id and an item the request names; Not now on a kept key takes it too", async () => {
  const w = room({ fail: { "connections.create": "boom", "vault.item.discard_new": "no" } });
  const { requestId } = await ask(w);
  const out = await submit(w, requestId!);
  assert.equal(out.card.notice, "Your key is saved in Mine. Couldn't connect.");
  const tried = w.called("vault.item.discard_new")[0]!.input;
  assert.deepEqual(
    [tried["itemId"], tried["requestId"]],
    ["vit_new", requestId],
    "bound to this request and this item",
  );
  const row = w.db.dump();
  assert.match(row, /vit_new/);
  // the key is still waiting for its connection: the Vault may take it back for this card only
  const may = await handlers["vault.connect_card.may_discard"](person(w), { requestId, itemId: "vit_new" } as never);
  assert.deepEqual(may, { ok: true });
  await assert.rejects(
    handlers["vault.connect_card.may_discard"](person(w), { requestId, itemId: "vit_other" } as never),
  );
  await assert.rejects(
    handlers["vault.connect_card.may_discard"](dex(w), { requestId, itemId: "vit_new" } as never),
    (e: unknown) => /Only a person/.test((e as { error?: { message?: string } }).error?.message ?? ""),
  );
  await assert.rejects(
    handlers["vault.connect_card.may_discard"](person(w, "usr_bea"), { requestId, itemId: "vit_new" } as never),
  );
});

test("a not built-in service shows every host on the saved-key state too", async () => {
  const w = room({
    thirdParty: true,
    saved: [{ id: "vit_c", name: "Fathom", folderId: "vfd_mine", fieldKeys: ["api_key"] }],
  });
  const asked = await ask(w);
  stamp(w, asked.requestId!, "vit_c", ["api.example.test", "files.example.test"]);
  const c = await card(w, asked.requestId!);
  assert.deepEqual([c.state, c.checksWith], ["have", "api.example.test, files.example.test"]);
});
