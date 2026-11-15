// The connect card on a booted daemon, the three review items closed (b-connect2, 15 Nov 2026; review r-keyreach-9-b-connect). Real chats, the real Vault, the real connectors module and capability pipeline;
// only the model is scripted and the outside network is a stand-in that writes down every request that reaches it (host and key).
//   Made for me + A: an agent asks to connect a service for Aina in a channel where Bilal is also present. Bilal sees that a connection was asked for and nothing of what Aina has or chooses; Aina pastes a key;
//     the agent that asked uses it at once; the saved item is Aina's, in Mine, and no other member reaches it. A key typed by hand under the service's own name is never offered back; the card's own save is.
//   B: a key goes only to the connection's recorded hosts: a call to a listed host carries it, a look-alike host and a redirect to another host never receive it.
//   C: no erase is reachable: the take-back refuses a key no card saved, and a finished request's key; declining a card leaves nothing in the Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { bootHour, say, twoMembers, messages, waitFor } from "./support/member-hour.ts";

process.env["VYRE_CONNECT_CARD"] = "1";

const SECRET = "fth_safe_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const HAND = "fth_by_hand_FAKEvalue0123456789abcdef"; // secret-scan: fake

interface Reached {
  host: string;
  path: string;
  key: string;
}
/** The apps' API as a stand-in: it writes down the host and the key of every request that reaches it. /redir answers a redirect to another host. */
const network = (seen: Reached[]) => ({
  resolve: async () => ["93.184.216.34"],
  request: async (url: URL, o: { headers: Record<string, string> }) => {
    const key = Object.entries(o.headers).find(([k]) => k.toLowerCase() === "x-api-key")?.[1] ?? "";
    seen.push({ host: url.hostname, path: url.pathname, key });
    if (url.pathname.endsWith("/redir"))
      return { status: 302, text: "", location: "https://other.fathom.example/steal" };
    return key.startsWith("bad") ? { status: 401, text: "{}" } : { status: 200, text: '{"items":[],"meta":{}}' };
  },
});

test("an agent asks for Aina in a channel with Bilal: Bilal sees an ask and nothing of Aina's Vault, Aina's card shows the hosts, her key is saved in Mine for her and her agent uses it at once", async () => {
  const seen: Reached[] = [];
  const h = await bootHour("connectsafe", { connectorNetwork: network(seen) });
  try {
    const { a, b } = await twoMembers(h);
    // a hand-made key named exactly like the service, with its field, in Aina's Mine: the name proves nothing
    const mine = (await a.call("vault.folders.list", { scope: "mine" })).folders?.[0]?.id as string | undefined;
    const folderId =
      mine ??
      ((await a.call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: "cs-mine" })).folder
        .id as string);
    await a.call("vault.item.put", {
      folderId,
      name: "Fathom",
      kind: "api_key",
      fields: [{ key: "api_key", value: HAND, secret: true }],
      idempotencyKey: "cs-hand",
    });

    // a channel of Aina, Bilal and two agents; Aina mentions the first agent, which asks to connect Fathom for her
    const second = (await h.owner.call("agents.create", { name: "Other", role: "You help the team." })).agent
      .agentId as string;
    const threadId = (await a.call("chat.start", { kind: "chat", agentIds: [h.agentId, second], personId: b.personId }))
      .thread.threadId as string;
    const first = await say(h, a, threadId, "please connect fathom").catch(async (e: unknown) => {
      console.error("DEBUG", JSON.stringify(await messages(h, a, threadId)).slice(0, 1500));
      throw e;
    });
    assert.equal(first, "Not yet. Add its key.");

    const block = (await messages(h, a, threadId))
      .flatMap((m) => m.blocks ?? [])
      .find((x) => x.type === "vault_request");
    assert.ok(block, "the card is in the channel");
    assert.equal(block.data.service, "fathom");
    const requestId = block.data.requestId as string;
    // Bilal is in the channel: he reads that a connection was asked of Aina (the card's block: a service, who asked, for whom), and nothing of what she has or chooses
    const bilalSees = JSON.stringify(await messages(h, b, threadId));
    assert.ok(bilalSees.includes('"service":"fathom"'), "Bilal sees that Fathom was asked for");
    assert.equal(
      /Fathom_|vit_|have|saved/i.test(bilalSees.replace(/"service":"fathom"/g, "")),
      false,
      "no key name or id",
    );
    const refused = await b.attempt("vault.connect_card.get", { requestId });
    assert.equal(refused.ok, false, "Bilal cannot read Aina's card");
    assert.equal((await b.attempt("vault.connect_card.options", { requestId })).ok, false);
    assert.equal(
      (await b.attempt("vault.connect_card.submit", { requestId, fields: [{ key: "api_key", value: SECRET }] })).ok,
      false,
    );

    // Aina's own card: the hosts the key goes to before she saves; the key she named by hand is NOT offered (A)
    const hers = (await a.call("vault.connect_card.get", { requestId })).card;
    assert.deepEqual(
      [hers.state, hers.have, hers.checksWith, hers.keptIn],
      ["ask", undefined, "api.fathom.ai", "Mine"],
    );

    // a wrong key keeps nothing; the right one connects
    const wrong = await a.call("vault.connect_card.submit", {
      requestId,
      fields: [{ key: "api_key", value: "bad-key-1" }],
    });
    assert.equal(wrong.result, "wrong");
    assert.equal(
      ((await a.call("vault.items.list", {})).items as Array<{ name: string }>).filter((i) => /^Fathom/.test(i.name))
        .length,
      1,
      "only the hand-made key is in the Vault",
    );
    const good = await a.call("vault.connect_card.submit", { requestId, fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(good.result, "connected", JSON.stringify(good));
    assert.equal(good.card.keptIn, "Mine");
    // made for me: the agent that asked uses it at once, with no second approval
    const used = await waitFor(
      async () =>
        (await messages(h, a, threadId)).find((m) => m.author?.kind === "agent" && /^(USED|FAILED)/.test(m.body ?? ""))
          ?.body ?? null,
      30_000,
      "the agent carries on",
    );
    assert.match(used, /^USED #Fathom_2 /, used);
    // the connection itself points at the item the card saved, by its handle, never at the older key of the same name
    const conn = JSON.stringify((await a.call("connections.list", { connector: "fathom" })).connections);
    assert.equal(conn.includes("#Fathom."), false, conn);
    const itemId = used.split(" ")[2]!;
    // OPEN QUESTION FOR THE LEAD, not asserted here: Mine is "you and the agents working for you" (test/vault.made-mine.live.test.ts), so a SECOND agent of Aina's in this chat reaches the key through her too.
    // The made-for-me rule as the lead words it ("no other agent can") needs the Vault's Mine access to change, which is outside this lane.
    // an agent calling any erase of a Vault item is refused (the discard has no tool; the Trash delete is held for a person), and the key is still there
    const erased = await say(h, a, threadId, `ERASE ${itemId} ${requestId}`);
    assert.match(erased, /^ERASE discard=refused delete=refused found=no/, erased);
    assert.equal((await a.attempt("vault.item.get", { itemId })).ok, true, "the key is still in the Vault");
    // the saved item is Aina's: Bilal's Vault and connections show nothing of it
    assert.equal(((await b.call("vault.items.list", {})).items as unknown[]).length, 0);
    assert.equal(((await b.call("connections.list", { connector: "fathom" })).connections as unknown[]).length, 0);
    assert.equal(
      (await b.attempt("vault.item.get", { itemId: used.split(" ")[2] })).ok,
      false,
      "another member cannot open Aina's key",
    );

    // A: after Disconnect the card offers back the key ITS OWN save made (Fathom_2), never the hand-made "Fathom"
    await a.call("vault.connect_card.disconnect", { requestId });
    await a.call("vault.connect_card.reopen", { requestId });
    const again = (await a.call("vault.connect_card.get", { requestId })).card;
    assert.deepEqual([again.state, again.have?.name, again.have?.keptIn], ["have", "Fathom_2", "Mine"]);
    // and Bilal still cannot read it
    assert.equal((await b.attempt("vault.connect_card.get", { requestId })).ok, false);

    // C: the take-back is bound to a card's open try: a finished request, a hand-made key and a bad request id are all refused
    const handItem = ((await a.call("vault.items.list", {})).items as Array<{ id: string; name: string }>).find(
      (i) => i.name === "Fathom",
    )!;
    const refusals = await Promise.all([
      a.attempt("vault.item.discard_new", { itemId: handItem.id, requestId }),
      a.attempt("vault.item.discard_new", { itemId: used.split(" ")[2], requestId }),
      a.attempt("vault.item.discard_new", { itemId: handItem.id, requestId: "vrq_00000000000000000000000000000000" }),
    ]);
    for (const r of refusals) assert.equal(r.ok, false, "no key but a card's open try can be taken back");
    assert.ok(
      ((await a.call("vault.items.list", {})).items as Array<{ name: string }>).some((i) => i.name === "Fathom"),
      "the hand-made key is still there",
    );
    assert.ok(
      seen.every((r) => r.host === "api.fathom.ai"),
      `every request went to the listed host: ${JSON.stringify(seen)}`,
    );
    assert.ok(!JSON.stringify(await messages(h, a, threadId)).includes(SECRET));
  } finally {
    await h.stop();
  }
});

test("B: a connection's key goes only to the hosts its record lists: a listed host gets it, a look-alike host and a redirect to another host never do", async () => {
  const seen: Reached[] = [];
  const h = await bootHour("connecthosts", { connectorNetwork: network(seen) });
  try {
    const own = h.owner;
    assert.equal(
      (
        await own.call("connectors.init", {
          key: "pages",
          title: "Pages",
          mode: "api",
          source: false,
          idempotencyKey: "ch-init",
        })
      ).connector?.key ?? "pages",
      "pages",
    );
    const def = await own.attempt("connectors.define", {
      key: "pages",
      title: "Pages",
      scope: "person",
      domains: ["api.fathom.ai"],
      auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" },
      secrets: [{ name: "api_key", description: "Your Pages API key" }],
      actions: [
        {
          name: "list",
          method: "GET",
          url: "https://api.fathom.ai/external/v1/pages",
          shape: { items: "/items", cursor: { kind: "link", next: "/meta/next" } },
        },
      ],
      idempotencyKey: "ch-def",
    });
    assert.equal(def.ok, true, JSON.stringify(def));
    assert.equal((await own.call("connectors.publish", { key: "pages", idempotencyKey: "ch-pub" })).published, true);
    // a connector that also declares another domain (or a wildcard) cannot be connected from a card at all
    await own.call("connectors.init", {
      key: "wide",
      title: "Wide",
      mode: "api",
      source: false,
      idempotencyKey: "ch-init2",
    });
    await own.call("connectors.define", {
      key: "wide",
      title: "Wide",
      scope: "person",
      domains: ["api.fathom.ai", "*.evil.example"],
      auth: { type: "api_key", header: "X-Api-Key", prefix: "", secret: "api_key" },
      secrets: [{ name: "api_key", description: "Your Wide API key" }],
      actions: [{ name: "list", method: "GET", url: "https://api.fathom.ai/external/v1/pages" }],
      idempotencyKey: "ch-def2",
    });
    await own.call("connectors.publish", { key: "wide", idempotencyKey: "ch-pub2" });
    assert.equal(
      (await own.call("connectors.for_service", { service: "Wide" })).found,
      false,
      "a wildcard cannot be a card's host",
    );

    const threadId = (await own.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string;
    const folderId = (await own.call("vault.folders.create", { name: "Keys", scope: "shared", idempotencyKey: "ch-f" }))
      .folder.id as string;
    await own.call("vault.item.put", {
      folderId,
      name: "Pages_key",
      kind: "api_key",
      fields: [{ key: "api_key", value: SECRET, secret: true }],
      idempotencyKey: "ch-k",
    });
    const made = await own.call("connections.create", {
      connector: "pages",
      title: "Pages",
      ownerKind: "space",
      secrets: { api_key: "#Pages_key.api_key" },
      idempotencyKey: "ch-conn",
    });
    const connectionId = made.connection.connectionId as string;
    await own.call("connections.mark_working", { connectionId, idempotencyKey: "ch-work" });
    void threadId;

    const run = (input: unknown) =>
      own.attempt("connectors.run", { key: "pages", action: "list", connectionId, input });
    // a listed host carries the key
    assert.equal((await run({})).ok, true);
    assert.deepEqual([seen.at(-1)?.host, seen.at(-1)?.key], ["api.fathom.ai", SECRET]);
    const before = seen.length;
    // a look-alike host (the listed name as a prefix of another) and a host reached by a redirect: refused, and the key reaches nobody
    const lookalike = await run({ after: "https://api.fathom.ai.evil.example/external/v1/pages" });
    assert.equal(lookalike.ok, false, "a look-alike host");
    const parent = await run({ after: "https://evilapi.fathom.ai.example/external/v1/pages" });
    assert.equal(parent.ok, false);
    const redirected = await run({ after: "https://api.fathom.ai/external/v1/redir" });
    assert.equal(redirected.ok, false, "a redirect to another host");
    assert.deepEqual(
      seen.slice(before).map((r) => `${r.host}${r.path}`),
      ["api.fathom.ai/external/v1/redir"],
      "only the listed host was reached, and nothing at the other host",
    );
    assert.ok(seen.every((r) => r.host === "api.fathom.ai"));
  } finally {
    await h.stop();
  }
});

test("C: declining the card leaves nothing behind in the Vault, and the take-back is reachable only from a card", async () => {
  const seen: Reached[] = [];
  const h = await bootHour("connectdecline", { connectorNetwork: network(seen) });
  try {
    const { a } = await twoMembers(h);
    const items = async () => ((await a.call("vault.items.list", {})).items as unknown[]).length;
    const first = await items();
    const threadId = (await a.call("chat.start", { kind: "chat", agentIds: [h.agentId] })).thread.threadId as string;
    assert.equal(await say(h, a, threadId, "please connect fathom"), "Not yet. Add its key.");
    const block = (await messages(h, a, threadId))
      .flatMap((m) => m.blocks ?? [])
      .find((x) => x.type === "vault_request")!;
    const requestId = block.data.requestId as string;
    await a.call("vault.requests.decline", { requestId });
    assert.equal((await a.call("vault.connect_card.get", { requestId })).card.state, "later");
    assert.equal(await items(), first, "nothing was saved");
    assert.equal(((await a.call("connections.list", { connector: "fathom" })).connections as unknown[]).length, 0);
    assert.equal(seen.length, 0, "no key was sent anywhere");
    const refusal = await a.attempt("vault.item.discard_new", {
      itemId: "vit_00000000000000000000000000000000",
      requestId,
    });
    assert.equal(refusal.ok, false);
  } finally {
    await h.stop();
  }
});
