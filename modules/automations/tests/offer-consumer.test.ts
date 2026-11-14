// The setup offer is made only for a saved item that can be an app: a key, an env block, a login or a loose item. Cards, notes, codes, SSH keys and AI accounts make none.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";
import { consumers } from "../impl.ts";
import { connectorOffers } from "../handlers/connector-offer.ts";
import { listOpenOffers } from "../offer-store.ts";
import type { OfferDb } from "../offer-store.ts";

test("only a saved item that can be an app gets an offer", () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  for (const [id, kind] of [
    ["vit_acme", "api_key"],
    ["vit_env", "env"],
    ["vit_login", "login"],
    ["vit_card", "card"],
    ["vit_note", "note"],
    ["vit_totp", "totp"],
    ["vit_ssh", "ssh_key"],
    ["vit_ai", "ai_subscription"],
  ] as const) {
    run(ctx as never, { payload: { itemId: id, kind, name: `Name ${id}` } });
  }
  run(ctx as never, { payload: { itemId: "vit_nokind", name: "Old event" } });
  assert.deepEqual(
    listOpenOffers(ctx.db as OfferDb)
      .map((o) => o.itemId)
      .sort(),
    ["vit_acme", "vit_env", "vit_login", "vit_nokind"],
  );
});

test("an offer for a Mine item is for the person who saved it; an offer for a shared item is the Space's", () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  run(ctx as never, {
    actor: "usr_alice",
    payload: { itemId: "vit_mine", kind: "api_key", scope: "mine", name: "Mine key" },
  });
  run(ctx as never, {
    actor: "usr_alice",
    payload: { itemId: "vit_shared", kind: "api_key", scope: "shared", name: "Shared key" },
  });
  const ids = (viewer?: string): string[] =>
    listOpenOffers(ctx.db as OfferDb, viewer)
      .map((o) => o.itemId)
      .sort();
  assert.deepEqual(ids("usr_alice"), ["vit_mine", "vit_shared"]);
  assert.deepEqual(ids("usr_bob"), ["vit_shared"], "another person does not see a Mine offer");
});

test("the offers list leaves out an AI account's key and an item that is gone or not visible", async () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  // an AI account added with an API key is saved as an api_key item, so the event alone cannot tell it apart
  for (const id of ["vit_acme", "vit_openai", "vit_gone"])
    run(ctx as never, { payload: { itemId: id, kind: "api_key", name: `Name ${id}` } });
  const calls: string[] = [];
  const withCall = {
    ...ctx,
    call: async (cap: string) => {
      calls.push(cap);
      if (cap === "providers.list") return { providers: [{ id: "prv_1", itemId: "vit_openai" }] };
      if (cap === "vault.items.list")
        return {
          items: [
            { id: "vit_acme", handle: "#Acme" },
            { id: "vit_openai", handle: "#OpenAI" },
          ],
        };
      if (cap === "agents.assistant_of") return { agentId: "agt_assist" };
      if (cap === "access.connector_builder.status") return { allowed: true, canGrant: true, reaches: true };
      throw new Error(`unexpected ${cap}`);
    },
  };
  const out = await connectorOffers(withCall as never);
  assert.deepEqual(
    out.offers.map((o) => o.itemId),
    ["vit_acme"],
  );
  assert.deepEqual([...new Set(calls)].sort(), [
    "access.connector_builder.status",
    "agents.assistant_of",
    "providers.list",
    "vault.items.list",
  ]);
});

const save = (ctx: ReturnType<ReturnType<typeof harness>["ctxFor"]>, ids: Record<string, string>): void => {
  for (const [id, name] of Object.entries(ids))
    consumers["automations.connector_offer"].run(ctx as never, { payload: { itemId: id, kind: "api_key", name } });
};

test("a company key is never offered: the assistant is not allowed to use it, so no setup for it can be finished", () => {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  save(ctx, { vit_dwd: "Google_DWD", vit_ms: "Microsoft App", vit_sso: "SSO Okta", vit_acme: "Acme" });
  assert.deepEqual(
    listOpenOffers(ctx.db as OfferDb).map((o) => o.itemId),
    ["vit_acme"],
  );
});

interface Setup {
  assistant?: string | null;
  status: Record<string, { allowed: boolean; canGrant: boolean; reaches?: boolean } | "throw">;
}
async function shown(setup: Setup, items: Record<string, string>): Promise<{ itemId: string; text: string }[]> {
  const h = harness();
  const ctx = h.ctxFor(null, alice);
  const run = consumers["automations.connector_offer"].run;
  for (const [id, name] of Object.entries(items)) run(ctx as never, { payload: { itemId: id, kind: "api_key", name } });
  const withCall = {
    ...ctx,
    call: async (cap: string, input: Record<string, unknown>) => {
      if (cap === "providers.list") return { providers: [] };
      if (cap === "vault.items.list")
        return { items: Object.entries(items).map(([id, name]) => ({ id, handle: `#${name.replace(/\W+/g, "_")}` })) };
      if (cap === "agents.assistant_of")
        return setup.assistant === null ? {} : { agentId: setup.assistant ?? "agt_assist" };
      if (cap === "access.connector_builder.status") {
        const st = setup.status[String(input["itemId"])] ?? setup.status["*"];
        if (st === "throw" || st === undefined) throw new Error("no");
        return st;
      }
      throw new Error(`unexpected ${cap}`);
    },
  };
  return (await connectorOffers(withCall as never)).offers;
}

test("an offer is shown only when the person's assistant can finish it", async () => {
  const items = { vit_ok: "Acme", vit_secret: "Zeta", vit_norole: "Borealis", vit_grant: "Cedar" };
  const out = await shown(
    {
      status: {
        vit_ok: { allowed: true, canGrant: false, reaches: true },
        vit_secret: { allowed: true, canGrant: true, reaches: false },
        vit_norole: { allowed: false, canGrant: false, reaches: true },
        vit_grant: { allowed: false, canGrant: true, reaches: true },
      },
    },
    items,
  );
  assert.deepEqual(out.map((o) => o.itemId).sort(), ["vit_grant", "vit_ok"]);
  assert.equal(out.find((o) => o.itemId === "vit_ok")!.text, "Set up Acme for Automations?");
  assert.match(
    out.find((o) => o.itemId === "vit_grant")!.text,
    /Set up Cedar for Automations\?.*assistant.*allowed to build connectors/i,
    "an admin is told the one thing pressing Set up also does",
  );
});

test("no assistant found, or a check that fails, shows nothing: an offer that cannot be confirmed is not shown", async () => {
  assert.deepEqual(
    await shown({ assistant: null, status: { "*": { allowed: true, canGrant: true } } }, { vit_a: "Acme" }),
    [],
  );
  assert.deepEqual(await shown({ status: { "*": "throw" } }, { vit_a: "Acme" }), []);
});
